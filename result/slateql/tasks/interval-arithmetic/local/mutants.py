#!/usr/bin/env python3
"""Mutant sweep: each mutant flips one decision in the solution and the graded
suite must fail at least one case. Runs in the work-interval repo on the
solution branch with the held-out files checked out from the heldout branch
as untracked files, then restores everything."""

import pathlib
import subprocess
import sys

WORK = pathlib.Path(__file__).resolve().parents[3] / "work-interval"
IV = "slateql/types/interval.py"
CO = "slateql/types/coercion.py"
AG = "slateql/functions/aggregate_defs.py"
PA = "slateql/sql/parser.py"
EX = "slateql/plan/expressions.py"
VA = "slateql/types/values.py"
TESTS = ["tests/test_intervals.py", "tests/test_interval_queries.py"]

MUTANTS = {
    # equality by fields instead of the thirty-day rule
    "eq_by_fields": (IV, "        return self.normalised() == other.normalised()",
                         "        return (self.months, self.days, self.micros) == (other.months, other.days, other.micros)"),
    # hash consistent with the fields, not the rule (DISTINCT / GROUP BY keys split)
    "hash_by_fields": (IV, '        return hash(("interval", self.normalised()))',
                           '        return hash(("interval", self.months, self.days, self.micros))'),
    # a month counts as 31 days when comparing
    "month_is_31_days": (IV, "DAYS_PER_MONTH = 30", "DAYS_PER_MONTH = 31"),
    # days applied before months
    "days_before_months": (IV, "    if interval.months:\n        total = base.year * 12",
                               "    base = base + dt.timedelta(days=interval.days)\n    if interval.months:\n        total = base.year * 12"),
    # no month-end clamp: overflow into the next month
    "no_month_clamp": (IV, "        base = base.replace(year=year, month=month, day=min(base.day, last))",
                           "        base = base.replace(year=year, month=month, day=1) + dt.timedelta(days=base.day - 1)"),
    # fractional months round instead of truncating
    "months_rounded": (IV, "    months = _truncate(months_exact)", "    months = round(months_exact)"),
    # fractional month carries at 31 days (scaling only)
    "carry_at_31": (IV, "    days_exact = self.days * factor + (months_exact - months) * DAYS_PER_MONTH",
                        "    days_exact = self.days * factor + (months_exact - months) * 31"),
    # timestamp difference normalises hours into days the Python way
    "difference_python_days": (IV, "        days, micros = _split(total, _MICROS_PER_DAY)\n        return cls(0, days, micros)",
                                   "        return cls(0, delta.days, delta.seconds * MICROS_PER_SECOND + delta.microseconds)"),
    # PT36H renders as P1DT12H
    "render_folds_hours": (IV, "    hours, rest = _split(interval.micros, _MICROS_PER_HOUR)\n    minutes, rest = _split(rest, _MICROS_PER_MINUTE)\n    parts = [\"P\"]",
                               "    extra_days, rest = _split(interval.micros, _MICROS_PER_DAY)\n    hours, rest = _split(rest, _MICROS_PER_HOUR)\n    minutes, rest = _split(rest, _MICROS_PER_MINUTE)\n    interval = Interval(interval.months, interval.days + extra_days, rest + hours * _MICROS_PER_HOUR + minutes * _MICROS_PER_MINUTE)\n    parts = [\"P\"]"),
    # zero renders as P0D
    "zero_as_p0d": (IV, '        return "PT0S"', '        return "P0D"'),
    # date - date becomes an interval
    "date_minus_date_interval": (CO, "            if lk is TypeKind.DATE and rk is TypeKind.DATE:\n                return INTEGER.as_nullable(nullable)\n",
                                     ""),
    # date + interval stays DATE
    "date_plus_interval_date": (CO, "        if lk in _TEMPORAL_KINDS and rk is interval:\n            return TIMESTAMP.as_nullable(nullable)",
                                    "        if lk in _TEMPORAL_KINDS and rk is interval:\n            return DataType(lk, nullable)"),
    # interval + integer allowed
    "interval_plus_integer": (CO, "        if lk is interval and rk is interval:\n            return INTERVAL.as_nullable(nullable)\n        if lk in _TEMPORAL_KINDS and rk is interval:",
                                  "        if lk is interval and (rk is interval or right.is_numeric):\n            return INTERVAL.as_nullable(nullable)\n        if lk in _TEMPORAL_KINDS and rk is interval:"),
    # AVG returns the plain sum
    "avg_is_sum": (AG, "        return self._total / self._count", "        return self._total if isinstance(self._total, Interval) else self._total / self._count"),
    # MIN/MAX refuse intervals (base behaviour)
    "extremes_refuse": ("slateql/types/datatypes.py", "_ORDERED = _NUMERIC | _TEMPORAL | {TypeKind.STRING, TypeKind.BOOLEAN, TypeKind.INTERVAL}",
                                                     "_ORDERED = _NUMERIC | _TEMPORAL | {TypeKind.STRING, TypeKind.BOOLEAN}"),
    # weeks fold into 5 days
    "week_is_five_days": (IV, '    days = int(groups["weeks"] or 0) * 7 + int(groups["days"] or 0)',
                              '    days = int(groups["weeks"] or 0) * 5 + int(groups["days"] or 0)'),
    # a leading sign is ignored
    "leading_sign_ignored": (IV, '    if groups["sign"] == "-":\n        result = -result', '    if False:\n        result = -result'),
    # P alone is accepted as zero
    "empty_duration_ok": (IV, '    if all(part is None for part in date_parts + time_parts):\n        raise ValueError', '    if False:\n        raise ValueError'),
    # unit form accepts fractions by truncating
    "unit_accepts_fraction": (PA, '                if not re.fullmatch(r"[+-]?\\d+", stripped):', '                stripped = stripped.split(".")[0]\n                if False:'),
    # folded literal prints as a quoted string (base to_sql)
    "literal_prints_quoted": (EX, "        if isinstance(self.value, Interval):\n            return f\"INTERVAL '{self.value}'\"\n", ""),
    # cast of bad text raises even without strict_casts
    "cast_always_strict": (VA, "    if isinstance(value, str):\n        return parse_interval(value)\n    raise TypeError(type(value).__name__)\n\n\ndef infer_column_type",
                               "    if isinstance(value, str):\n        try:\n            return parse_interval(value)\n        except ValueError as exc:\n            raise ExecutionError(str(exc)) from exc\n    raise TypeError(type(value).__name__)\n\n\ndef infer_column_type"),
    # extract('day') folds hours into days
    "extract_day_folds_hours": (IV, '    if unit == "day":\n        return interval.days', '    if unit == "day":\n        return interval.days + _split(interval.micros, _MICROS_PER_DAY)[0]'),
    # negative micros split with Python floor semantics
    "split_floors": (IV, "    whole = abs(total) // unit\n    rest = abs(total) - whole * unit\n    if total < 0:\n        return -whole, -rest\n    return whole, rest",
                         "    return divmod(total, unit)"),
    # timedelta rows keep the raw timedelta
    "timedelta_not_converted": (VA, "    if isinstance(value, dt.timedelta):\n        return Interval.from_timedelta(value)\n    return value", "    return value"),
    # seconds rendered as a float with trailing zeros
    "seconds_trailing_zeros": (IV, '    fraction = f"{abs(rest):06d}".rstrip("0")', '    fraction = f"{abs(rest):06d}"'),
}


def run(*args, check=True, **kw):
    return subprocess.run(args, cwd=WORK, check=check, capture_output=True, text=True, **kw)


def main() -> int:
    names = sys.argv[1:] or list(MUTANTS)
    run("git", "checkout", "-q", "solution")
    for t in TESTS:
        (WORK / t).write_bytes(run("git", "show", f"heldout:{t}").stdout.encode())
    failures = []
    try:
        for name in names:
            path, old, new = MUTANTS[name]
            target = WORK / path
            original = target.read_text()
            if original.count(old) != 1:
                print(f"{name:28s} ANCHOR MISSING ({original.count(old)})")
                failures.append(name)
                continue
            target.write_text(original.replace(old, new))
            try:
                result = run("python3", "-m", "pytest", "-q", "-p", "no:cacheprovider", *TESTS, check=False)
                summary = [line for line in result.stdout.splitlines() if " passed" in line or " failed" in line or " error" in line]
                tail = summary[-1] if summary else result.stdout[-200:]
                killed = result.returncode != 0
                if not killed:
                    failures.append(name)
                print(f"{name:28s} {'KILLED' if killed else '*** SURVIVED ***'}  {tail.strip()[:90]}")
            finally:
                target.write_text(original)
    finally:
        for t in TESTS:
            (WORK / t).unlink(missing_ok=True)
    if failures:
        print("SURVIVORS / FAULTS:", failures)
        return 1
    print("all mutants killed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

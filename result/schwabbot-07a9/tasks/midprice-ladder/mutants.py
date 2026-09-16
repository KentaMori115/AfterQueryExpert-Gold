#!/usr/bin/env python3
"""Break the reference one rule at a time; every break must be caught.

Each mutant flips exactly one clause the instruction states. A mutant that
still passes the graded suite is a promise nothing enforces.
"""
import pathlib
import shutil
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
WORK = HERE.parents[1] / "work"
IMAGE = "sbot07a9-env:v2"

MUTANTS = [
    ("floor the raw quotient like the old helper did", "Engine/pricing.py",
     """    rule = ROUND_CEILING if up else ROUND_FLOOR
    rungs = (_dec(price) / step).quantize(Decimal(1), rounding=rule)
    return float(rungs * step)""",
     """    import math as _m
    q = float(price) / float(tick)
    n = _m.ceil(q) if up else _m.floor(q)
    return round(n * float(tick), 10)"""),

    ("ignore which side the account is on when snapping", "Engine/ladder.py",
     "    favour_up = bool(credit)",
     "    favour_up = False"),

    ("value short legs at their ask in the far touch", "Engine/pricing.py",
     """            short_mid += mid
            short_far += bid""",
     """            short_mid += mid
            short_far += ask"""),

    ("value long legs at their bid in the far touch", "Engine/pricing.py",
     """            long_mid += mid
            long_far += ask""",
     """            long_mid += mid
            long_far += bid"""),

    ("price a credit the same way as a debit", "Engine/pricing.py",
     """    if credit:
        return short_mid - long_mid, short_far - long_far
    return long_mid - short_mid, long_far - short_far""",
     """    return long_mid - short_mid, long_far - short_far"""),

    ("accept a leg that has no ask", "Engine/pricing.py",
     """    if bid is None or ask is None:
        return None""",
     """    if bid is None:
        return None
    if ask is None:
        ask = bid"""),

    ("accept a leg that has no bid", "Engine/pricing.py",
     """    if bid is None or ask is None:
        return None""",
     """    if ask is None:
        return None
    if bid is None:
        bid = ask"""),

    ("serve a partial package when a leg is unquoted", "Engine/pricing.py",
     """        touches = leg_touches(symbol, quotes)
        if touches is None:
            return None, None""",
     """        touches = leg_touches(symbol, quotes)
        if touches is None:
            continue"""),

    ("space the rungs over steps instead of steps minus one", "Engine/ladder.py",
     "            raw = span_start + (span_end - span_start) * index / float(steps - 1)",
     "            raw = span_start + (span_end - span_start) * index / float(steps)"),

    ("keep a rung that repeats the one before it", "Engine/ladder.py",
     """        if rungs and price == rungs[-1]:
            continue""",
     """        if False:
            continue"""),

    ("quote a rung that is not worth anything", "Engine/ladder.py",
     "        if price is None or price <= 0:",
     "        if price is None:"),

    ("apply the cap to each rung after spacing them", "Engine/ladder.py",
     """        span_start = min(span_start, ceiling)
        span_end = min(span_end, ceiling)""",
     """        span_end = min(span_end, ceiling)"""),

    ("let a replacement re-quote rung 0 every time", "Engine/bot/bot01_engine.py",
     "        price = plan.price_at(rung_index)",
     "        price = plan.price_at(0)"),

    ("let a replacement claim a rung it did not have", "Engine/bot/bot01_engine.py",
     "        return worked_a_rung",
     "        return True"),

    ("ignore the admin ladder size", "Engine/bot/bot01_engine.py",
     """        plan = self.working_plan(payload, quotes, trading_symbol,
                                 self.ladder_size(), width)""",
     """        plan = self.working_plan(payload, quotes, trading_symbol, 4, width)"""),

    ("never read ladder_steps out of the admin settings", "Engine/bot/bot01_engine.py",
     "        return clamp_steps(admin_info.get('ladder_steps', BOT1_LADDER_STEPS))",
     "        return BOT1_LADDER_STEPS"),

    ("read the admin ladder size under a different name", "Engine/bot/bot01_engine.py",
     "        return clamp_steps(admin_info.get('ladder_steps', BOT1_LADDER_STEPS))",
     "        return clamp_steps(admin_info.get('ladder_size', BOT1_LADDER_STEPS))"),

    ("size the real order off the opening midpoint", "Engine/bot/bot01_engine.py",
     """                        sizing_plan = self.build_ladder(payload, username, trading_symbol, spread_diff)
                        if sizing_plan is not None and sizing_plan.final_price is not None:
                            lot_size = sizing_plan.lot_size(acc_balance, risk_percentage)""",
     """                        sizing_plan = None
                        if sizing_plan is not None and sizing_plan.final_price is not None:
                            lot_size = sizing_plan.lot_size(acc_balance, risk_percentage)"""),

    ("ignore the cap altogether", "Engine/ladder.py",
     """    if cap is not None:
        try:
            ceiling = float(cap)
        except (TypeError, ValueError):
            return []
        span_start = min(span_start, ceiling)
        span_end = min(span_end, ceiling)""",
     """    if False:
        pass"""),

    ("snap toward the far touch instead of the account", "Engine/ladder.py",
     "        price = snap(raw, tick, favour_up)",
     "        price = snap(raw, tick, not favour_up)"),

    ("size on the opening rung", "Engine/ladder.py",
     "        worst = float(prices[-1])",
     "        worst = float(prices[0])"),

    ("round the lot count to nearest instead of down", "Engine/ladder.py",
     "    lots = int(math.floor(budget / cost_per_lot))",
     "    lots = int(round(budget / cost_per_lot))"),

    ("hand back a fractional lot count", "Engine/ladder.py",
     """    lots = int(math.floor(budget / cost_per_lot))
    return lots if lots > 0 else 0""",
     """    lots = budget / cost_per_lot
    return lots if lots > 0 else 0"""),

    ("let a single step still walk to the far touch", "Engine/ladder.py",
     """        if steps == 1:
            raw = span_start""",
     """        if steps == 1:
            raw = span_end"""),

    ("read the far touch as a second midpoint", "Engine/pricing.py",
     """        if leg_is_short(leg):
            short_mid += mid
            short_far += bid
        else:
            long_mid += mid
            long_far += ask""",
     """        if leg_is_short(leg):
            short_mid += mid
            short_far += mid
        else:
            long_mid += mid
            long_far += mid"""),

    ("drop the hundred multiplier from the lot cost", "Engine/ladder.py",
     "    cost_per_lot = worst * 100.0",
     "    cost_per_lot = worst"),

    ("let the ladder start somewhere other than the midpoint", "Engine/ladder.py",
     """        if steps == 1:
            raw = span_start
        else:
            raw = span_start + (span_end - span_start) * index / float(steps - 1)""",
     """        if steps == 1:
            raw = span_start
        else:
            raw = span_start + (span_end - span_start) * (index + 1) / float(steps)"""),

    ("hand back an empty ladder when a leg has no quote", "Engine/ladder.py",
     """    if mid is None or far is None or tick is None or steps is None:
        return []""",
     """    if tick is None or steps is None:
        return []
    if mid is None or far is None:
        return [0.01]"""),

    ("treat every package as a credit", "Engine/pricing.py",
     '''    return str(payload.get("orderType") or "").strip().upper() == "NET_CREDIT"''',
     "    return True"),
]

MUTANTS += [
    # The exact defect quality review said the suite had to catch: Bot1 keeps
    # replacing at the price it opened with.
    ("let Bot1 re-quote its opening rung every time", "Engine/bot/bot01_engine.py",
     "        return list(self.working_plan(payload, quotes, symbol, steps, width).prices)",
     """        _plan = self.working_plan(payload, quotes, symbol, steps, width)
        if _plan.opening_price is None:
            return []
        return [_plan.opening_price] * len(_plan.prices)"""),

    ("let Bot1 ignore the width of a defined risk package", "Engine/bot/bot01_engine.py",
     "        return plan_for_payload(payload, quotes, steps, get_ticksize(symbol), width)",
     "        return plan_for_payload(payload, quotes, steps, get_ticksize(symbol), None)"),

    ("let Bot1 price every symbol on the penny grid", "Engine/bot/bot01_engine.py",
     "        return plan_for_payload(payload, quotes, steps, get_ticksize(symbol), width)",
     "        return plan_for_payload(payload, quotes, steps, 0.01, width)"),

    ("let Bot1 hand back the plan instead of its prices", "Engine/bot/bot01_engine.py",
     "        return list(self.working_plan(payload, quotes, symbol, steps, width).prices)",
     "        return list(reversed(self.working_plan(payload, quotes, symbol, steps, width).prices))"),
]

SUITES = ["tests.test_working_orders", "tests.test_order_concession"]


def run(tree):
    proc = subprocess.run(
        ["docker", "run", "--rm", "--network", "none",
         "-v", f"{tree}:/app", "-w", "/app", IMAGE,
         "python3", "manage.py", "test", *SUITES],
        capture_output=True, text=True)
    return proc.returncode, proc.stdout + proc.stderr


def main():
    caught = 0
    escaped = []
    for index, (label, rel, old, new) in enumerate(MUTANTS, 1):
        with tempfile.TemporaryDirectory() as tmp:
            tree = pathlib.Path(tmp) / "app"
            shutil.copytree(WORK, tree)
            target = tree / rel
            text = target.read_text()
            if old not in text:
                print(f"{index:2d}. SETUP FAILED  {label}: anchor not found in {rel}")
                escaped.append(label)
                continue
            target.write_text(text.replace(old, new, 1))
            code, output = run(tree)
            if code == 0:
                print(f"{index:2d}. ESCAPED       {label}")
                escaped.append(label)
            else:
                failed = [ln for ln in output.splitlines() if ln.startswith("FAILED")]
                print(f"{index:2d}. caught        {label}  {failed[0] if failed else ''}")
                caught += 1
    print(f"\n{caught}/{len(MUTANTS)} mutants caught")
    if escaped:
        print("ESCAPED:")
        for label in escaped:
            print("  -", label)
    return 1 if escaped else 0


if __name__ == "__main__":
    sys.exit(main())

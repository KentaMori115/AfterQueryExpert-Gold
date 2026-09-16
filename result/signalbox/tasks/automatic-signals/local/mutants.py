#!/usr/bin/env python3
"""Mutant sweep: each mutant breaks one sentence of instruction.md and the
graded suite must fail at least one case.

The tree under test is the heldout branch of ../../work-automatic, which
carries the reference solution and the two graded files, materialised once into
a scratch directory; each mutant edits that copy, runs the two graded files in
the env image, and is reverted. A mutant that survives means a promise the
instruction makes is not graded.
"""

import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
WORK = HERE.parents[2] / "work-automatic"
IMG = "signalbox-env:v2"
TESTS = [
    "tests/verify/test_unattended_signals.py",
    "tests/sim/test_unattended_working.py",
]

AUTO = "src/signalbox/signalling/automatic.py"
CHECK = "src/signalbox/verify/checks/automatic.py"
MACHINE = "src/signalbox/sim/machine.py"
SETTING = "src/signalbox/verify/checks/setting.py"
SCENARIO = "src/signalbox/sim/scenario.py"
CLI = "src/signalbox/cli/commands/automatic.py"


MUTANTS = {
    # "One route reads from it"
    "a_choice_of_routes_is_allowed": (
        AUTO,
        """    if len(plans) > 1:
        return AutoSignal(
            signal,
            fault=AutoFault.CHOICE,
            detail=", ".join(sorted(plan.name for plan in plans)),
        )
""",
        "",
    ),
    # "that route holds no points of its own"
    "points_on_the_route_are_ignored": (
        AUTO,
        "    wanted = dict(plan.points())",
        "    wanted: dict = {}",
    ),
    # "none in its overlap"
    "points_in_the_overlap_are_ignored": (
        AUTO,
        "    wanted.update(plan.overlap_points())\n",
        "",
    ),
    # "One route reads from it": a signal with no route is not one route
    "a_signal_with_no_route_passes": (
        AUTO,
        "    if not plans:\n        return AutoSignal(signal, fault=AutoFault.NO_ROUTE)\n",
        '    if not plans:\n        return AutoSignal(signal, route="nothing")\n',
    ),
    # "check reports it against the signal"
    "the_finding_is_about_something_else": (
        CHECK,
        "            subject=found.signal,",
        "            subject=str(found.fault),",
    ),
    # "under one new error rule"
    "the_rule_is_only_advice": [
        (CHECK, 'Severity.ERROR)\ndef automatic_signals_can_work', 'Severity.ADVICE)\ndef automatic_signals_can_work'),
        (CHECK, "            severity=Severity.ERROR,", "            severity=Severity.ADVICE,"),
    ],
    # "Its route then stands set. Set when a machine is built"
    "nothing_is_set_when_the_machine_is_built": (
        MACHINE,
        "            self._entered.setdefault(plan.name, set())\n        self._work_automatic_routes()\n",
        "            self._entered.setdefault(plan.name, set())\n",
    ),
    # "set again as soon as track it wants comes free ... a train has left"
    "it_never_takes_the_track_back": [
        (MACHINE, "    def _release(self, route: str) -> None:\n        self._free(route)\n        self._work_automatic_routes()\n",
                  "    def _release(self, route: str) -> None:\n        self._free(route)\n"),
        (MACHINE, "            self._finish_if_done(state.name)\n        self._work_automatic_routes()\n",
                  "            self._finish_if_done(state.name)\n"),
        (MACHINE, "                self._release(state.name)\n        self._work_automatic_routes()\n",
                  "                self._release(state.name)\n"),
    ],
    # "Asking for it ... refused"
    "asking_for_it_is_granted": (
        MACHINE,
        '        if self.automatic.is_automatic(route):\n            return Outcome(False, f"{route} is worked automatically")\n        return self._set(route)',
        "        return self._set(route)",
    ),
    # "cancelling it ... refused"
    "cancelling_it_is_granted": (
        MACHINE,
        '    def cancel(self, route: str) -> Outcome:\n        """Ask for a route to be given up."""\n        if self.automatic.is_automatic(route):\n            return Outcome(False, f"{route} is worked automatically")\n',
        '    def cancel(self, route: str) -> Outcome:\n        """Ask for a route to be given up."""\n',
    ),
    # "and releasing it are all refused"
    "releasing_it_is_granted": (
        MACHINE,
        '        if self.automatic.is_automatic(route):\n            return Outcome(False, f"{route} is worked automatically")\n        state = self.state.route(route)\n        if not state.held and state.status is not RouteStatus.CALLED:\n            return Outcome(False, f"{route} is not set")\n\n        release = self.emergency[route]',
        '        state = self.state.route(route)\n        if not state.held and state.status is not RouteStatus.CALLED:\n            return Outcome(False, f"{route} is not set")\n\n        release = self.emergency[route]',
    ),
    # "rules that work the interlocking rather than read it stop reporting these"
    "the_machine_rules_report_it_as_a_fault": (
        SETTING,
        "    for plan in context.plans():\n        if context.automatic.is_automatic(plan.name):\n            continue\n        machine = _machine(context)",
        "    for plan in context.plans():\n        machine = _machine(context)",
    ),
    # "puts an automatic signal back to danger and holds it there"
    "the_signal_does_not_stay_replaced": (
        MACHINE,
        "        self.state.replace(signal)\n        state = self.state.route(route)",
        "        state = self.state.route(route)",
    ),
    # "giving its route up the way cancelling does, approach locking and all"
    "replacement_skips_the_approach_locking": (
        MACHINE,
        "        if state.held or state.status is RouteStatus.CALLED:\n            return self._give_up(route)\n        self.refresh_aspects()\n        return ACCEPTED\n\n    def work_automatically",
        "        if state.held or state.status is RouteStatus.CALLED:\n            self._free(route)\n        self.refresh_aspects()\n        return ACCEPTED\n\n    def work_automatically",
    ),
    # "Machine.work_automatically(signal) hands it back"
    "giving_it_back_leaves_the_signal_off": (
        MACHINE,
        "        self.state.work_automatically(signal)\n        self._work_automatic_routes()\n",
        "        self.state.work_automatically(signal)\n",
    ),
    # "Both refuse for any signal trains do not work" (the replacement side)
    "a_signal_nobody_took_away_is_given_back": (
        MACHINE,
        '        if not self.state.is_replaced(signal):\n            return Outcome(False, f"{signal} is not replaced")\n',
        "",
    ),
    # "Scenarios say replace K5 and automatic K5"
    "the_scenario_verb_is_missing": (
        SCENARIO,
        '    "automatic": _do_automatic,\n',
        "",
    ),
    # "and expect signal K5 replaced or signal K5 automatic"
    "the_expectation_never_fails": (
        SCENARIO,
        '    if what == "replaced":\n        return None if replaced else f"{name} is not replaced"',
        '    if what == "replaced":\n        return None',
    ),
    # "signalbox automatic PLAN prints ... route it works"
    "the_command_prints_no_route": (
        CLI,
        '        found.route or "-",',
        '        "-",',
    ),
    # "for the rest names the routes it had a choice of or the points wanting moved"
    "the_command_gives_no_reason": (
        CLI,
        '        found.detail if found.detail else ("" if found.works else str(found.fault)),',
        '        "",',
    ),
    # "--faults narrows to those"
    "the_faults_flag_is_ignored": (
        CLI,
        "    found = working.faults() if faults else working.sorted_signals()",
        "    found = working.sorted_signals()",
    ),
    # "--locks prints panel moves an automatic route shuts out"
    "the_locks_flag_finds_nothing": (
        CLI,
        "        against = sorted(set(matrix.against(plan.name)) & automatic)\n        if against:",
        "        against = sorted(set(matrix.against(plan.name)) & automatic)\n        if False:",
    ),
}


def run_suite(tree: pathlib.Path) -> tuple[int, int]:
    for cache in tree.rglob("__pycache__"):
        shutil.rmtree(cache, ignore_errors=True)
    proc = subprocess.run(
        ["docker", "run", "--rm", "--network", "none", "-v", f"{tree}:/app", "-w", "/app",
         IMG, "python", "-B", "-m", "pytest", "-p", "no:cacheprovider", "-o", "addopts=",
         "-q", *TESTS],
        capture_output=True, text=True,
    )
    tail = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else proc.stderr[-300:]

    def count(word: str) -> int:
        found = re.search(r"(\d+) " + word, tail)
        return int(found.group(1)) if found else 0

    return count("failed") + count("error"), count("passed")


def main() -> int:
    tree = pathlib.Path(tempfile.mkdtemp(prefix="mutants-"))
    subprocess.run(f"git -C {WORK} archive heldout | tar -x -C {tree}", shell=True, check=True)

    ok = True
    try:
        for name, spec in MUTANTS.items():
            edits = spec if isinstance(spec, list) else [spec]
            originals = {}
            for path, old, new in edits:
                target = tree / path
                text = originals.get(path, target.read_text())
                assert text.count(old) == 1, (name, path, text.count(old))
                originals.setdefault(path, text)
                target.write_text(target.read_text().replace(old, new))
            try:
                failed, passed = run_suite(tree)
            finally:
                for path, text in originals.items():
                    (tree / path).write_text(text)
            ok = ok and failed > 0
            verdict = "caught" if failed else "*** SURVIVED ***"
            print(f"{name:44s} failed={failed:3d} passed={passed:3d}  {verdict}")
        failed, passed = run_suite(tree)
        print(f"{'(restored solution)':44s} failed={failed:3d} passed={passed:3d}")
    finally:
        shutil.rmtree(tree, ignore_errors=True)
    return 0 if ok and failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

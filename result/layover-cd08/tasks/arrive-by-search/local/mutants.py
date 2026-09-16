"""Break the reference solution one decision at a time and see the suite notice.

Each entry names a file, a fragment to find and what to put in its place. A
mutation the graded suite does not catch is a rule nobody is checking.
"""
import pathlib, shutil, subprocess, sys, tempfile

HERE = pathlib.Path(__file__).resolve().parents[3]
WORK = HERE / "abs-work"
B = "layover/plan/backward.py"
R = "layover/report/journey.py"
C = "layover/cli/commands.py"

MUTANTS = [
    ("alight flag read as a boarding flag", B,
     "                if not pattern.can_alight(index):\n                    continue\n                if not self._pattern_allowed",
     "                if not pattern.can_board(index):\n                    continue\n                if not self._pattern_allowed"),
    ("boarding flag read as an alighting flag", B,
     "            if riding is not None and pattern.can_board(index):",
     "            if riding is not None and pattern.can_alight(index):"),
    ("change buffer charged for a walk as well", B,
     "            ready = label.departure - (self.options.min_transfer_seconds if label.by_ride else 0)",
     "            ready = label.departure - self.options.min_transfer_seconds"),
    ("change buffer never charged", B,
     "            ready = label.departure - (self.options.min_transfer_seconds if label.by_ride else 0)",
     "            ready = label.departure"),
    ("walks followed the way the network indexes them", B,
     "            for transfer in self._transfers_to(stop_id):",
     "            for transfer in self.network.transfers_from(stop_id):"),
    ("search window ignored", B,
     "        horizon = by - options.search_window",
     "        horizon = 0"),
    ("journeys taken from the backward pass rather than a forward one", B,
     "        forward = JourneySearch(self.timetable, self.options)\n        found = forward.plan(origin, destination, day, latest)\n        return tuple(journey for journey in found if journey.arrival <= by)",
     "        rounds = self._search(destination, origin, day, by)\n        found = [self._reconstruct(rounds, labels[origin])\n                 for labels in rounds if origin in labels]\n        return tuple(j for j in found if j is not None and j.arrival <= by)"),
    ("late arrivals left in", B,
     "        return tuple(journey for journey in found if journey.arrival <= by)",
     "        return found"),
    ("destination left in the backward answer", B,
     "        best.pop(destination, None)\n        return best",
     "        return best"),
    ("arriving exactly on the deadline counted as late", B,
     "            if entries[middle][0] <= ready:",
     "            if entries[middle][0] < ready:"),
    ("yesterday's service day not read", B,
     "            for offset in range(0, -self.timetable.days_back - 1, -1):",
     "            for offset in range(0, -1, -1):"),
    ("earliest arrival preferred over the latest", B,
     "            if riding is None or candidate[0] > riding[0]:",
     "            if riding is None or candidate[0] < riding[0]:"),
    ("earliest departure kept at a stop", B,
     "                if departure > best.get(stop_id, _NEVER) and departure >= horizon:",
     "                if departure < best.get(stop_id, -_NEVER) and departure >= horizon:"),
    ("walking backward added to the clock", B,
     "                departure = label.departure - transfer.seconds",
     "                departure = label.departure + transfer.seconds"),
    ("earliest workable departure answered", B,
     "            if best is None or journey.departure > best:",
     "            if best is None or journey.departure < best:"),
    ("going nowhere allowed", B,
     '        if origin is not None and origin == destination:\n            raise PlanError("a journey has to go somewhere: %r to itself" % origin)',
     "        if False:\n            pass"),
    ("a deadline before the service day allowed", B,
     '        if by < 0:\n            raise PlanError("a deadline cannot fall before the service day")',
     "        if False:\n            pass"),
    ("stops not looked up at all", B,
     "        if origin is not None:\n            self.network.stop(origin)\n        self.network.stop(destination)",
     "        return"),
    ("spare time worked out the wrong way round", R,
     "                format_duration(by - journey.arrival) if by is not None else \"\",",
     "                format_duration(journey.arrival - by) if by is not None else \"\","),
    ("spare column left out", R,
     '        ("Leaves", "Arrives", "Takes", "Changes", "Spare", "Using"),',
     '        ("Leaves", "Arrives", "Takes", "Changes", "Using"),'),
    ("deadline not named in the title", R,
     '    title = "Arriving by %s" % format_short(by) if by is not None else "Journeys"',
     '    title = "Journeys"'),
    ("the latest flag printing the whole report", C,
     "    if arguments.latest:\n        latest = session.latest_departure(",
     "    if False:\n        latest = session.latest_departure("),
    ("the ordinary report used instead", C,
     "    report = session.arrive_by_report(journeys, deadline)",
     "    report = session.journeys_report(journeys)"),
]


def run(tree):
    """Run the graded selection in a tree and say whether it all passed."""
    done = subprocess.run(
        [sys.executable, "-m", "unittest", "-q",
         "tests.test_plan_backward", "tests.test_arrive_by"],
        cwd=tree, capture_output=True, text=True)
    return done.returncode == 0


def main():
    caught = 0
    for label, target, before, after in MUTANTS:
        with tempfile.TemporaryDirectory() as scratch:
            tree = pathlib.Path(scratch) / "tree"
            shutil.copytree(WORK, tree, ignore=shutil.ignore_patterns(".git", "__pycache__"))
            path = tree / target
            text = path.read_text()
            if before not in text:
                print("MISSING  %s (fragment not found in %s)" % (label, target))
                continue
            path.write_text(text.replace(before, after, 1))
            if run(tree):
                print("SURVIVED %s" % label)
            else:
                caught += 1
                print("caught   %s" % label)
    print("%d of %d mutations caught" % (caught, len(MUTANTS)))
    return 0 if caught == len(MUTANTS) else 1


if __name__ == "__main__":
    sys.exit(main())

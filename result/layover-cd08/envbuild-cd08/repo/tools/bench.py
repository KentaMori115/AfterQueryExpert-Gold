"""Time the parts of layover that could get slow, on a network big enough to tell.

Run it with ``python3 tools/bench.py``. It builds a grid city, then times
building, indexing, boards, searches and the whole day's reachability. Numbers
are from one machine on one day and are only worth comparing against each other.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from layover.dates import DateRange
from layover.network import NetworkBuilder
from layover.plan import JourneySearch, SearchOptions
from layover.services import ServiceCalendar, ServiceRegistry
from layover.timetable import Timetable
from layover.times import parse_clock

DAY = date(2026, 7, 15)
PERIOD = DateRange(date(2026, 7, 1), date(2026, 7, 31))


def grid(side, headway=600, first="06:00", last="22:00"):
    """A side by side grid of stops, a line along every row and column."""
    builder = NetworkBuilder("grid")
    for row in range(side):
        for column in range(side):
            builder.stop(
                "s-%02d-%02d" % (row, column),
                "Stop %d %d" % (row, column),
                "52.%06d" % (500000 + row * 4000),
                "13.%06d" % (300000 + column * 6000),
                zone="A",
            )
    for index in range(side):
        row_stops = ["s-%02d-%02d" % (index, column) for column in range(side)]
        column_stops = ["s-%02d-%02d" % (row, index) for row in range(side)]
        builder.route("row-%02d" % index, "R%d" % index, mode="tram")
        builder.route("col-%02d" % index, "C%d" % index, mode="bus")
        builder.pattern("row-%02d-east" % index, "row-%02d" % index, row_stops, "East")
        builder.pattern("col-%02d-south" % index, "col-%02d" % index, column_stops, "South")
    for index in range(side):
        for prefix, hop in (("row-%02d-east", 180), ("col-%02d-south", 240)):
            pattern_id = prefix % index
            start = parse_clock(first) + (index % 5) * 60
            finish = parse_clock(last)
            number = 0
            while start <= finish:
                times = [start + step * hop for step in range(side)]
                builder.trip("%s-%03d" % (pattern_id, number), pattern_id, "daily", times)
                number += 1
                start += headway
    return builder.build()


def timed(label, work, rounds=1):
    """Run something and print how long it took."""
    started = time.monotonic()
    result = None
    for _ in range(rounds):
        result = work()
    spent = time.monotonic() - started
    print("%-34s %7.1f ms%s" % (label, spent * 1000, "" if rounds == 1 else " (%d runs)" % rounds))
    return result


def run(side):
    """Time everything once, on a grid of the given size."""
    network = timed("build %d by %d" % (side, side), lambda: grid(side))
    print("%-34s %7d" % ("trips", len(network.trips())))
    registry = ServiceRegistry([ServiceCalendar.weekly("daily", range(7), PERIOD)])
    timetable = Timetable(network, registry)
    timed("first day lookup", lambda: timetable.trip_count(DAY))
    timed("second day lookup", lambda: timetable.trip_count(DAY))
    middle = "s-%02d-%02d" % (side // 2, side // 2)
    timed("board, 20 times", lambda: timetable.departures(middle, DAY, limit=10), rounds=20)
    search = JourneySearch(timetable, SearchOptions(max_transfers=2))
    corner, far = "s-00-00", "s-%02d-%02d" % (side - 1, side - 1)
    timed("plan corner to corner", lambda: search.plan(corner, far, DAY, parse_clock("08:00")))
    timed(
        "plan, 20 times",
        lambda: search.plan(corner, far, DAY, parse_clock("08:00")),
        rounds=20,
    )
    timed("reach everywhere", lambda: JourneySearch(timetable, SearchOptions()).reachable(
        corner, DAY, parse_clock("08:00")
    ))


def main(argv=None):
    """Read the arguments and run the bench."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--side", type=int, default=12, help="how many lines each way")
    arguments = parser.parse_args(argv)
    run(arguments.side)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Build patches that get one rule of the contract wrong, for the local battery.

Each mutant is the reference solution with a single substitution applied. A
mutant that still scores 1 is a rule the held-back suite does not really check.
"""

from __future__ import annotations

import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
WORK = HERE.parents[2] / "work"
OUT = HERE / "mutants"

MUTANTS = {
    # A week that starts on Sunday rather than Monday.
    "sunday-weeks": [(
        "layover/fares/cap.py",
        "return day - timedelta(days=day.weekday())",
        "return day - timedelta(days=(day.weekday() + 1) % 7)",
    )],
    # A charge counted only against the cap that bound it.
    "binding-cap-only": [(
        "layover/fares/travel.py",
        """    for cap, key in applying:
        spent[key] = spent.get(key, nothing) + charged
        limits[key] = cap""",
        """    for cap, key in applying:
        if cap.price - spent.get(key, nothing) == charged:
            spent[key] = spent.get(key, nothing) + charged
        limits[key] = cap""",
    )],
    # Zones read off the first ride of a ticket instead of all of them.
    "first-ride-zones": [(
        "layover/fares/travel.py",
        """    for ride in ticket.rides:
        for stop_id in ride.stops():
            zone = zones.zone_of(stop_id)
            if zone not in touched:
                touched.append(zone)
    return tuple(touched)""",
        """    ride = ticket.rides[0]
    for stop_id in ride.stops():
        zone = zones.zone_of(stop_id)
        if zone not in touched:
            touched.append(zone)
    return tuple(touched)""",
    )],
    # Tickets bought over the whole run rather than one service day at a time.
    "tickets-span-days": [(
        "layover/fares/travel.py",
        """    for day, group in _by_day(_in_order(rides)):
        for ticket in price_rides(group, table, zones).tickets:
            charges.append(_charge(ticket, day, table, zones, spent, limits))""",
        """    ordered = _in_order(rides)
    for ticket in price_rides(ordered, table, zones).tickets:
        charges.append(
            _charge(ticket, ticket.rides[0].service_day(), table, zones, spent, limits)
        )""",
    )],
    # No remainder: a ticket is charged in full until the cap is reached.
    "no-remainder": [(
        "layover/fares/travel.py",
        "        charged = charged.capped_at(cap.price - spent.get(key, nothing))",
        """        if not (cap.price - spent.get(key, nothing)).cents > 0:
            charged = nothing""",
    )],
    # A tie in conditions settled by the dearer cap.
    "dearer-wins": [(
        "layover/fares/table.py",
        "key=lambda cap: (-cap.specificity, cap.price.cents, cap.cap_id),",
        "key=lambda cap: (-cap.specificity, -cap.price.cents, cap.cap_id),",
    )],
    # A cap that names a route covers a ticket riding any route.
    "route-ignored": [(
        "layover/fares/cap.py",
        """        if self.route_id is not None:
            ridden = set(routes)
            if not ridden or ridden != {self.route_id}:
                return False""",
        """        if self.route_id is not None:
            ridden = set(routes)
            if ridden and self.route_id not in ridden:
                return False""",
    )],
    # The written feed loses the route a cap named.
    "route-dropped-by-writer": [(
        "layover/feed/writer.py",
        """                    "zone": cap.zone,
                    "route_id": cap.route_id,
                }""",
        """                    "zone": cap.zone,
                }""",
    )],
    # What four of five calibration trials did: write caps into the saved
    # document, which moves a pinned digest.
    "document-grows-caps": [(
        "layover/document/write.py",
        """            for rule in table.rules()
        ],
    }""",
        """            for rule in table.rules()
        ],
        "caps": [
            {"id": cap.cap_id, "price": str(cap.price.amount), "period": cap.period}
            for cap in table.caps()
        ],
    }""",
    )],
    # Travel taken in whatever order it arrives.
    "any-order": [(
        "layover/fares/travel.py",
        """        if previous is not None and here < previous:
            raise FareError("travel is charged in order, and %s comes after a later ride" % ride)""",
        """        if previous is not None and here < previous:
            previous = here""",
    )],
}


def run(*args, **kw):
    return subprocess.run(args, cwd=str(WORK), check=True, capture_output=True, text=True, **kw)


def build(name, edits):
    branch = "mutant-" + name
    subprocess.run(["git", "-C", str(WORK), "branch", "-D", branch],
                   capture_output=True, text=True)
    run("git", "checkout", "-q", "-b", branch, "solution")
    for path, before, after in edits:
        target = WORK / path
        text = target.read_text()
        if before not in text:
            raise SystemExit("%s: %r not found in %s" % (name, before[:60], path))
        target.write_text(text.replace(before, after, 1))
    run("git", "commit", "-qam", "mutant " + name)
    patch = run("git", "diff", "main", branch).stdout
    (OUT / (name + ".patch")).write_text(patch)
    run("git", "checkout", "-q", "solution")
    print("%-20s %d bytes" % (name, len(patch)))


def main():
    OUT.mkdir(exist_ok=True)
    for name, edits in MUTANTS.items():
        build(name, edits)
    return 0


if __name__ == "__main__":
    sys.exit(main())

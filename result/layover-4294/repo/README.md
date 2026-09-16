# layover

A timetable and journey planning engine for scheduled transport. It reads a feed
of tables, builds an immutable network of stops, routes, patterns and trips, and
answers the two questions a passenger actually asks: what leaves this stop next,
and how do I get from here to there.

Python 3.10 or newer. Standard library only, no dependencies, no network access,
and no clock inside the engine: the same query on the same feed answers the same
way today, next year and in any interpreter.

```python
from datetime import date
from layover import Session
from layover.times import parse_clock

session = Session.demo()
journeys = session.plan("westtor", "flughafen", date(2026, 7, 15), parse_clock("08:00"))
print(session.itinerary(journeys[0], priced=True).as_text())
```

```
Westtor to Flughafen, 08:00
Time   Service  Takes  From     To
-----------------------------------------
08:00  U1       15m    Westtor  Ostfeld
       wait     11m
08:26  B10      15m    Ostfeld  Flughafen

Arrives 08:41 after 41m.
1 changes, 0m walking.
Fare 2.40 EUR on one ticket.
```

From a shell:

```
python -m layover board hbf-u1 --after 08:00 --limit 5
python -m layover plan westtor flughafen --after 08:00 --itinerary --fare
python -m layover timetable u1 --window 08:00-10:00
python -m layover diagram u2
python -m layover frequency --routes
python -m layover --feed path/to/feed check
```

## What it does

- **Reads and writes a feed** of comma separated tables, collecting every
  problem in one pass instead of stopping at the first. What it writes reads
  back unchanged.
- **Holds a network** of agencies, stops, stations, routes, patterns, trips and
  transfers, built once with every reference checked and read only afterwards.
- **Keeps service calendars** as a weekly pattern, a period and the exceptions
  that add or drop single dates.
- **Reads the network through a date**, yesterday's after midnight service
  included, and answers boards, printed timetables and how often things run.
- **Plans journeys** with a round based search over time and changes, returning
  the journeys worth offering rather than only the quickest.
- **Prices them** against zone based fare rules.
- **Checks a feed** with twenty checks, from stops nothing calls at to trips
  that overtake each other.
- **Saves everything** as one versioned document, and migrates the two older
  versions of that format on the way in.

## Layout

| Layer | Package | Holds |
| --- | --- | --- |
| errors | `layover.errors` | every failure, with a code and a place |
| values | `times`, `dates`, `geo`, `money` | seconds, dates, microdegrees, decimals |
| model | `services`, `network`, `fares` | calendars, the network, fare rules |
| reading | `feed`, `timetable` | the table format, the network read by date |
| answering | `plan`, `document` | journey search, the saved form |
| output | `report` | boards, timetables, itineraries, diagrams |
| checking | `validate` | the twenty checks |
| example | `demo` | Marnstadt, the worked example |
| façade | `session`, `cli` | one object, and the command line |

`docs/design.md` has the reasoning, `docs/format.md` the feed format,
`docs/guide.md` a walk through, `docs/glossary.md` the words, and
`docs/performance.md` where the time goes.

## Running the suite

```
make check
```

That runs the tests, the demo and the command line. The suite is about eighteen
hundred tests and takes a few seconds. Beside the ordinary tests it holds:

- `tests/test_package.py`, which requires a docstring on everything public, a
  sorted `__all__` that names what exists, no doctests, no clock or randomness
  anywhere in the engine, and a layering table an import cannot quietly cross.
- `tests/test_reproducibility.py`, which pins seven digests and works them out
  again in a fresh interpreter under three hash seeds.
- `tests/test_invariants.py`, which walks the whole demo and asserts what has to
  hold everywhere.
- `tests/test_differential.py`, which answers the search again by brute force
  and compares.
- `tests/test_scale.py`, which runs a grid city of two and a half thousand trips.

## What is deliberately missing

These are not oversights. Each one is a real piece of work that the design has
room for and does not do, and the code does not pretend otherwise.

1. **Real time updates.** Delays, cancellations and extra trips applied over the
   static timetable, and a search that respects them.
2. **Frequency based services.** A headway written once and expanded into trips
   on demand, rather than every trip written out.
3. **Arrive by search.** Planning backwards from a time you have to be there,
   which is not the same search run in reverse.
4. **More criteria.** Trading off walking distance and fare as well as arrival
   and changes, and returning the whole frontier.
5. **Isochrones.** Everywhere reachable inside a time budget, as an area rather
   than a list of stops.
6. **Fare capping and whole journey pricing.** Daily and weekly caps, period
   passes, transfer discounts, and choosing the product from the journey's own
   zones rather than from the first ride of each ticket.
7. **Generated footpaths.** Working out that two stops are walkable from where
   they are, instead of using only the transfers a feed declares.
8. **Blocks and interlining.** Staying aboard when one trip becomes the next.
9. **Time zones.** Daylight saving and feeds that span more than one zone; the
   timezone an agency declares is recorded and not interpreted.
10. **Shapes.** The line a route follows on the ground, and distance along it.
11. **Accessibility.** Step free stops, wheelchair and bicycle rules, and
    searches that respect them.
12. **Pattern compression.** Folding thousands of near identical patterns
    together, for feeds that write one per trip.
13. **Feed differencing.** What changed between two versions of the same feed.
14. **A packed index.** Holding a national feed without reading it all into
    memory.
15. **Booking rules.** On demand services, call ahead windows and pickup by
    arrangement.

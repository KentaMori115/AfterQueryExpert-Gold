# layover design

layover answers two questions about scheduled transport: *what leaves this stop
next*, and *how do I get from here to there*. It reads a feed of tables, builds
an immutable network, and searches it. Python 3.10 or newer, standard library
only, no clocks and no network access inside the engine.

## Layers

A package may import a package below it in this table and nothing else, not even
across a row. `tests/test_package.py` holds the same numbers and fails the suite
if an import crosses them.

| Layer | Package | Holds |
| --- | --- | --- |
| 0 | `errors` | every failure, with a code and a place |
| 1 | `times`, `dates`, `geo`, `money` | values with no domain meaning |
| 2 | `services`, `network`, `fares` | calendars, the network, fare products and rules |
| 3 | `feed`, `timetable` | the table format, and the network read through a date |
| 4 | `plan`, `document` | journey search, and the versioned save format |
| 5 | `report` | boards, grids, itineraries, diagrams, summaries |
| 6 | `validate` | the checks over a loaded feed |
| 7 | `demo` | the worked example network |
| 8 | `session` | the façade the README shows |
| 9 | `cli` | the command line |

## Rules the code keeps to

- **Time is an integer.** Seconds since the start of the service day, so a trip
  that leaves at 25:10 keeps its ordering against one that leaves at 01:10 the
  next day. `times.parse_clock` accepts both and never guesses.
- **Nothing floats.** Fares are `Decimal`, coordinates are microdegrees, and
  distances come back as whole metres. `document.digest` refuses a float.
- **The network is immutable once built.** `network.builder` is the only way to
  make one, and it validates as it goes. Everything downstream reads.
- **A search is a function of its inputs.** No wall clock, no environment, no
  iteration over an unordered set. The same query on the same network gives the
  same journeys in the same order, in any interpreter.
- **Errors carry a code and a place.** Every failure names the table, the row and
  the field it came from, so a feed with a thousand problems reports all of them.

## Why fares sit under the search rather than over it

Pricing takes a sequence of rides, where a ride is a route, two stops and two
times. It does not take a journey. That keeps `fares` under `plan` rather than
over it, so the same code prices a planned journey, a list read off a ticket
machine and a hand written example in a test, and the search never has to know
what a fare is.

## What is deliberately missing

`README.md` ends with fifteen numbered gaps. They are not oversights and they
are not to be filled in passing. The ones that touch this table are the packed
on-disk index, which would go under `feed`, and the real time layer, which would
sit between `timetable` and `plan`.

# A walk through layover

Everything below runs against Marnstadt, the demo network that ships with the
package: six routes, eighteen stops, a station with two platforms and a ferry
that only crosses in the middle of the day. `layover/demo/city.py` builds it.

## The short path

```python
from datetime import date
from layover import Session

session = Session.demo()
print(session)
```

```
Marnstadt: 1 agencies, 4 fares, 12 patterns, 6 routes, 3 services, 18 stops, 6 transfers, 1149 trips
```

A session over your own feed is the same object:

```python
session = Session.from_feed("path/to/feed")     # a directory of tables
session = Session.from_document("network.json") # one saved file
```

## What leaves this stop

```python
from layover.times import parse_clock

board = session.board("hbf-u1", date(2026, 7, 15), parse_clock("08:00"), limit=5)
print(board.as_text())
```

```
Departures from Hauptbahnhof (platform 1), 2026-07-15
Time   Route  Towards  Trip
-----------------------------------------
08:07  U1     Ostfeld  u1-east-weekday-07
08:18  U1     Westtor  u1-west-weekday-07
08:27  U1     Ostfeld  u1-east-weekday-08
08:38  U1     Westtor  u1-west-weekday-08
08:47  U1     Ostfeld  u1-east-weekday-09
```

Every report renders three ways: `as_text()`, `as_markdown()` and `as_csv()`.

## How do I get there

```python
journeys = session.plan("westtor", "flughafen", date(2026, 7, 15), parse_clock("08:00"))
print(session.journeys_report(journeys).as_text())
```

```
Journeys
Leaves  Arrives  Takes  Changes  Using
---------------------------------------
08:00   08:41    41m          1  U1 B10
```

More than one journey comes back when more than one is worth having. The search
keeps a journey if nothing else both arrives at least as early **and** changes at
least as few times, so a slow direct ride is still offered beside a quick one
with a change.

For the whole leg by leg story, with the fare:

```python
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

## What are my options this morning

```python
from layover.times import TimeWindow

for journey in session.plan_window(
    "westtor", "ostfeld", date(2026, 7, 15), TimeWindow.parse("08:00-08:45")
):
    print(journey)
```

```
08:00-08:15 (15m, 0 changes)
08:20-08:35 (15m, 0 changes)
08:40-08:55 (15m, 0 changes)
```

## How often does it run

```python
print(session.frequency(date(2026, 7, 15), TimeWindow.parse("08:00-09:00")).as_text())
```

```
Frequency at 08:00-09:00, 2026-07-15
Stop         Name          Departures  Per hour  Headway  Worst wait  Even
--------------------------------------------------------------------------
flughafen    Flughafen              3         3  20m      20m         yes
gartenstadt  Gartenstadt            6         6  9m48s    11m         yes
hafen        Hafen                  6         6  8m48s    16m         no
hbf-u1       Hauptbahnhof           6         6  10m12s   11m         yes
```

`session.profile("hafen", day)` slices one stop across the whole day instead.

## Is the feed any good

```python
findings = session.check()
print(findings.summary())
print(findings.as_report().as_text())
```

Twenty checks run: stops nothing calls at, calendars that cover no date, trips
that overtake each other, transfers nobody could walk in the time given, zone
pairs no fare covers, and a feed that is really two networks in one file. None
of them refuse to work; they say what will surprise a passenger.

## From the shell

```
python -m layover board hbf-u1 --after 08:00 --limit 5
python -m layover plan westtor flughafen --after 08:00 --itinerary --fare
python -m layover timetable u1 --window 08:00-10:00
python -m layover diagram u2
python -m layover frequency --routes
python -m layover --feed path/to/feed check
python -m layover save network.json
```

Global options go before or after the command word. `--format markdown` and
`--format csv` change the rendering. The exit code is 0 when there is an answer,
3 when the question was fine but nothing matched, 2 for a misused command line
and 1 when the feed could not be read.

## What to reach for underneath

| Question | Where |
| --- | --- |
| read a feed | `layover.feed.load_feed`, `layover.feed.read_directory` |
| hold a network | `layover.network.NetworkBuilder`, `Network` |
| which days does it run | `layover.services.ServiceCalendar` |
| what runs on this date | `layover.timetable.Timetable` |
| plan a journey | `layover.plan.plan_journeys`, `JourneySearch` |
| price one | `layover.fares.price_rides` |
| print something | `layover.report` |
| check a feed | `layover.validate.validate` |
| save it | `layover.document.save_document` |

## Two things worth knowing

**Time is an integer.** Every time in the engine is seconds since the start of
the service day, so `24:50` is a real time and sorts after `23:50`. Boards asked
about a date also show yesterday's service that is still running.

**A fare is bought for the first ride.** The product is chosen from the zones of
the first ride of each ticket, and covers as many changes as it allows inside
its window. A journey that starts inside the city and ends outside is priced on
the inner fare, which is not what every operator does. Pricing from the whole
journey's zones is one of the gaps listed in the README.

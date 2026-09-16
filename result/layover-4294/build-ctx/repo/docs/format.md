# The feed format

A feed is a directory of comma separated files, one per table, each with a
header row. Column order in the file does not matter; column names do. Unknown
columns are read and kept but not interpreted, so a feed carrying extra fields
for another tool still loads.

`layover.feed.tables` is the authority: the reader checks a file against it, the
writer emits columns in the order it lists, and the checks quote it. If this
page and that module ever disagree, the module is right.

## Which tables have to be there

`stops`, `routes`, `patterns`, `pattern_stops`, `trips` and `stop_times` are
required. At least one of `calendars` and `calendar_dates` has to be there too,
because a timetable with no calendar never runs. Everything else is optional and
a missing file is the same as an empty one.

## Tables

### stops.csv

| Column | Required | Meaning |
| --- | --- | --- |
| `stop_id` | yes | unique within the feed |
| `name` | yes | what a passenger calls it |
| `lat`, `lon` | no | decimal degrees, rounded once to millionths |
| `parent` | no | the station this platform sits in |
| `kind` | no | `stop`, `station` or `entrance`; `0`, `1`, `2` also read |
| `zone` | no | the fare zone |
| `code` | no | the number on the pole |
| `platform` | no | shown on a board beside the name |

A station is never called at. A trip stops at a platform inside it, and the
walk between two platforms is a row in `transfers.csv`.

### routes.csv

| Column | Required | Meaning |
| --- | --- | --- |
| `route_id` | yes | unique within the feed |
| `short_name` | no | `U2`, `100`; at least one name is required |
| `long_name` | no | `Ruhleben to Pankow` |
| `mode` | no | `tram`, `metro`, `rail`, `bus`, `ferry`, `cable`, `gondola`, `funicular`, or the number a feed writes |
| `agency_id` | no | who runs it |
| `colour` | no | six hex digits, with or without a leading hash |

### patterns.csv and pattern_stops.csv

A pattern is a route, a direction and the stops called at in order. Trips that
call at the same stops in the same order share one.

| Column | Required | Meaning |
| --- | --- | --- |
| `pattern_id` | yes | unique within the feed |
| `route_id` | yes | the route it belongs to |
| `headsign` | no | what the front of the vehicle says |
| `direction` | no | `0` or `1` |

`pattern_stops.csv` carries one row per call: `pattern_id`, `sequence`,
`stop_id`, and the optional flags `pickup` and `dropoff`. Sequence numbers only
have to sort; they do not have to start at one or run without gaps. A flag left
blank means the passenger may board or alight there.

### trips.csv and stop_times.csv

| Column | Required | Meaning |
| --- | --- | --- |
| `trip_id` | yes | unique within the feed |
| `pattern_id` | yes | the pattern it runs |
| `service_id` | yes | the calendar that says which days |
| `headsign` | no | overrides the pattern's |
| `short_name` | no | a train number, say |
| `block_id` | no | recorded and not acted on |

`stop_times.csv` carries `trip_id`, `sequence`, `arrival` and the optional
`departure`, which defaults to the arrival. A trip needs exactly as many rows as
its pattern has stops.

Times are `HH:MM` or `HH:MM:SS` on the **service day**, and hours run past 24.
A tram leaving at ten to one in the morning, as part of the previous day's
service, is written `24:50`. That is not a curiosity: it is what keeps the
ordering right, and a board asked about the following morning still shows it.

### calendars.csv and calendar_dates.csv

`calendars.csv` is a weekly pattern over a period: `service_id`, the seven
weekday flags `monday` to `sunday`, then `start_date` and `end_date`, both
included. `calendar_dates.csv` patches single dates: `service_id`, `date`, and
`exception` of `add` or `remove`. A date that is both added and removed does not
run, because removing is the stronger statement.

Dates are `YYYY-MM-DD` or `YYYYMMDD`.

### transfers.csv

`from_stop`, `to_stop`, `seconds`, and an optional `kind` of `walk`,
`in-station` or `stay-seated`. Transfers are one way, so a walk that works both
ways is written twice. Only declared transfers are used: nothing is inferred
from how close two stops happen to be.

### fare_products.csv and fare_rules.csv

A product is `fare_id`, `price`, an optional `currency` (`EUR` by default),
`transfers` (how many changes it covers, blank meaning any), `window` (how many
seconds it stays valid, blank meaning the whole journey) and a `name`.

A rule is `fare_id` with any of `from_zone`, `to_zone` and `route_id`. The most
specific matching rule wins; a tie goes to the cheaper product, so the order the
rules are written in never matters.

## A very small feed

```
stops.csv
    stop_id,name,lat,lon,zone
    a,Market,52.500000,13.300000,A
    b,Station,52.500000,13.320000,A

routes.csv
    route_id,short_name,mode
    x,X,tram

patterns.csv
    pattern_id,route_id,headsign
    x-east,x,Station

pattern_stops.csv
    pattern_id,sequence,stop_id
    x-east,1,a
    x-east,2,b

trips.csv
    trip_id,pattern_id,service_id
    t1,x-east,weekday

stop_times.csv
    trip_id,sequence,arrival
    t1,1,08:00:00
    t1,2,08:10:00

calendars.csv
    service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date
    weekday,1,1,1,1,1,0,0,2026-07-01,2026-07-31
```

## Reading and writing

```
python -m layover --feed path/to/feed check
python -m layover --feed path/to/feed save network.json
python -m layover --document network.json export other/feed
```

What the writer emits reads back into the same network, byte for byte the same
on a second pass. `tests/test_feed_writer.py` holds that to it.

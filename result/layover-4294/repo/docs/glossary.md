# Glossary

The words this codebase uses, and what they mean here. Several of them mean
something slightly different in other timetable software, so this page is the
one to trust when reading the code.

**Agency** — whoever runs a route. Recorded, along with a timezone that is not
interpreted anywhere.

**Arrival** — when a trip reaches a call. Held apart from the departure, because
a vehicle can stand at a platform and a connection made off the arrival is not
the same as one made off the departure.

**Board** — the list of departures or arrivals at one stop on one date, in time
order. A board entry knows both when it happens on the date asked about and what
its own service day calls that moment.

**Call** — one stop of one trip: a stop, an arrival, a departure and a position
in the pattern.

**Component** — a group of stops that connect to each other and not to the rest
of the feed. A feed with two components is two networks in one file.

**Dwell** — how long a vehicle stands at a call, the departure less the arrival.

**Feed** — a directory of comma separated tables describing a network, its
calendars and its fares. See `docs/format.md`.

**Frequency** — how often something leaves inside a window, as against when the
next one leaves. Carries the count, the gaps and whether they are even enough to
turn up without a timetable.

**Headway** — the gap between one departure and the next.

**Hop** — the stretch between two calls of a trip.

**Journey** — how a passenger gets from one stop to another: a sequence of legs
that join up. A journey has a departure, an arrival, a duration and a number of
changes.

**Leg** — one ride or one walk inside a journey.

**Mode** — how a route moves: tram, metro, rail, bus, ferry, cable, gondola or
funicular.

**Network** — every stop, route, pattern, trip and transfer, with the indexes a
search needs. Built once by the builder and read afterwards.

**Pattern** — a route, a direction, and the ordered stops a set of trips calls
at, with the flags saying where boarding and alighting are allowed. Trips
sharing a pattern differ only in when.

**Product** — a ticket: a price, how many changes it covers and for how long.

**Profile** — either every journey leaving inside a window, or a stop's service
sliced across the day. The two live in `layover.plan` and
`layover.timetable.frequency` respectively.

**Round** — one iteration of the journey search. Round one uses one vehicle,
round two uses two, and walking a declared transfer does not start a new round.

**Route** — the name on the front of the vehicle. It does not say where the
vehicle goes; a pattern does.

**Service** — a calendar, named by an identifier that trips point at. It says
which dates run, not what runs.

**Service day** — the day a trip belongs to, which is not the calendar day. A
trip that leaves at 24:50 belongs to the day before and calls at 00:50 the next
morning.

**Station** — a group of stops that share a name and a concourse. Nothing calls
at a station; trips call at the platforms inside it.

**Stop** — where a vehicle calls, or where a passenger stands.

**Transfer** — a declared walk between two stops, with the time it takes. Only
declared transfers exist: nothing is inferred from how close two stops are.

**Trip** — one vehicle running one pattern once, with a time at every call and
a service saying which days it runs.

**Window** — a half open span of service time, the start included and the end
not.

**Zone** — the fare area a stop sits in. A platform with no zone of its own
takes the zone of its station.

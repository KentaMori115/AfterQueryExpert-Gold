Everything here plans forward. Somebody due at the airport by nine guesses
a departure, tries it, guesses again.

Give it the other direction. Add `plan_arriving_by(timetable, origin,
destination, day, by, options=None)` and a `BackwardSearch` class beside
`JourneySearch`, both reachable from `layover.plan`, and hang
`latest_departure`, `reaching`, `plan_arriving_by` and `arrive_by_report` off
`Session`.

`latest_departure` answers with a moment: the last at which setting off
still gets you there by `by`, or `None` when nothing does. Arriving
exactly on the deadline counts. `reaching(destination, day, by)` answers the
same for every stop that can make it, leaving the destination out as
`reachable` leaves the origin out. `plan_arriving_by` hands back what the
ordinary search offers from that moment, less anything turning up late.

Limits in `SearchOptions` bite as they do forward, the window measured back
from the deadline. A change still needs `min_transfer_seconds` between one ride
and the next; a walk needs none and is still no change of vehicle; yesterday's
late service is on offer as a board offers it. A journey may
only end where alighting is allowed and start where boarding is. Declared
transfers run one way, so walking one backward means the walks that end at a
stop. Going nowhere, a stop nothing has heard of, or a deadline before the service
day are all refused as `plan` refuses them.

`report.journey.arrive_by_report(journeys, network, by)` titles them `Arriving
by 09:00` under Leaves, Arrives, Takes, Changes, Spare, Using, spare being
deadline less arrival, and notes `No journey was found.` with none.

`python -m layover arrive westtor flughafen --by 09:00` prints that;
`--latest` prints the moment alone; `--itinerary`, `--fare` and `--changes`
read as under `plan`; the global options work as everywhere else; nothing found
exits 3.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

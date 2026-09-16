`section TB counted over E2` marks that track an axle counter section rather
than a track circuit. Parser reads it, `Section.is_counted` reports it, nothing
else has ever looked.

A counted section wants a counting head on each of its own legs a train can
leave by onto track the section does not cover, and on any leg running to a
scheme boundary. A leg ending at a buffer stop wants none, and so does a join
buried inside one section. Name a head for its node, or for node and leg where
the plan names legs, as points, crossings and slips do in `docs/language.md`.

Counted sections a train can run directly between form one reset zone, named
for whichever sorts first. Two legs of the same points are not directly
connected, so they stay apart unless something else joins them. A track circuit
sits in no zone.

Publish both. Section records in the interchange file carry `zone` and `heads`,
counted sections only, and the file still passes its own schema. The locking
table grows a `zones` column, and a route whose track lies wholly inside one
zone releases `complete` where it said `sectional`. A `signalbox heads` command
prints the schedule, `--zones` the zones, `--shared` only what comes out of use
alongside something else. One rule, `detection-zone`, reports each zone covering
more than one section against that zone's name, and it is not an error.

Recorded output under `tests/golden/` moves.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

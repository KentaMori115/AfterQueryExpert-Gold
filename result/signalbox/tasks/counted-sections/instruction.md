Counted sections get declared, then forgotten.

Plan:

    section TA counted over E1
    section TB counted over E2

Section.is_counted reports it. Nothing reads that.

Axle counters are bounded by heads, not joints. Counted section wants a head on
each of its own legs a train can leave by onto track it does not cover, and one
on any leg reaching a scheme boundary. Buffer stop wants none. No axle passes a
dead end. Join inside one section, none either. Head takes its node's name, or
node and leg where the plan names legs, as points, crossings and slips do in
docs/language.md.

A count is worth nothing over track a train can enter unseen. So counted
sections a train runs directly between get reset as a group, one zone, named
for whichever sorts first. Two legs of one set of points are not directly
connected, so they stay apart unless something else joins them. Track circuit
sits in no zone.

Then publish it. On counted sections only, interchange section records grow
zone, that zone's name, and heads, every head name sorted. Track circuit grows
neither. File still passes its own schema, and its version does not move.
Locking table grows a zones column, last and defaulted, so rows built the old
way still build. Route whose track and overlap all sit in one zone has nothing
to give up piecemeal. Releases complete where it said sectional. signalbox
heads prints the schedule, --zones the zones, --shared only what resets with
something else. One rule, detection-zone, names each zone covering more than
one section. Not an error. Changelog counts the rules, so that number moves
too.

Goldens move.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

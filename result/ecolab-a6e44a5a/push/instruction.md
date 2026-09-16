Four fields come off every authored effect and two of them reach a tick. Those
two land badly. One quantity goes onto every pool of that resource, the flow
names a region picked by array position, and it reports what was asked
for, not what the pool gave.

An effect may name a `region`, and may name `forTicks`, one by default. It runs
from its hook's tick for that many ticks. Hooks are read in tick order, then by
event id, then in file order.

A `resource` with a `quantity` moves pools of that resource, or one region's
pool where a region is named. That quantity divides across them in proportion
to what each holds when the effect runs. Division floors, leftover units walk
those pools one each in region id order, and pools empty between them share it
evenly. A withdrawal takes no more than a pool holds, and no other pool covers
it. Every pool that moved publishes its own flow, carrying that
pool's region and what it really gave up or took on.

A `modifier` with a `factor` scales the habitat modifier of that key while its
window runs, in one region or everywhere. Two windows over one key multiply in
firing order, rounding half-even at each step. Renewal reads the scaled factor.
Such an effect publishes no flow.

Compiling fails where an effect names a resource or region nobody defined,
where it carries neither pair, where `forTicks` is under one or fractional, or
where `factor` sits below nought.

`event list` prints event ids in order. `event show <id>` prints a line an
effect, naming its resource or modifier key, and exits 3 on an id nobody
authored.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

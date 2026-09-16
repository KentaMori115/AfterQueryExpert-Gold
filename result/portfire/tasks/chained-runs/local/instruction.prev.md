Chain fusing exists in portfire only as advice. `chainCandidates` and PF3500
say a run could be one chain, nothing lets a script ask for it, so a rack we
fuse by hand still burns one pin per shell. Add a `chained` clause to
`ripple` and `fan`; parsed statements then carry `chained: true`.

A chained run fires from one output. Its head shot takes a pin the way any
single shot would, and a `pin` clause on the run fixes that pin, nothing
else. Every later shot is lit by quickmatch. Each shot stays its own event in
`compile()`'s schedule and its own assignment, all on the head's address,
carrying `fuse`: gap from the head's cue time to its own, zero on the head.
Follower ignition is head ignition plus fuse. Quantisation snaps the head
alone; followers move with it and report its drift as theirs. `fmt` writes
the clause and the run's pin back. `chained` on `fire` or `chase`, `chained` beside `jitter`,
a run longer than `MAX_CHAIN_LENGTH`, and a run with no interval are errors,
the last two producing no shots.

Everything downstream follows one rule. A chained run is one cue, many shots.
Whatever counts cues, rows, outputs, pins, leads or pulses sees the head
alone: firing table rows and cue numbers, `findEvent` by number, module load
pulses, rehearsal outputs, wiring runs, `moduleLoads`, diff keys, and
doubling, which backs a chain up once. Whatever counts shots, shells, tubes,
stock, hazard or what is lit sees every shot: density, rack layout, tube
order, `permitFacts.shotCount` against its `cueCount`. Chain candidates skip
runs already chained. In a diff, a chain whose shot count or fuse spacing
changed is a swap.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

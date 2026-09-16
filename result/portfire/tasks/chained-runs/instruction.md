Fuse a rack by hand and portfire still wants a pin per shell, chain fusing being advice only. Let a ripple or fan say so:

    at 18.0  ripple 6 of shell.75 from pad.a every 400ms chained
    at 64.0  fan 7 of shell.75 from pad.b spread 1.6s chained pin 2.05

Statements carry `chained: true`, fmt writes it back, pin too.

One match lights the head, quickmatch does the rest. Head gets allocated like any single shot, a pin clause on the run fixes that pin only, and followers land on its address. Each shot stays its own schedule event and assignment, carrying fuse, milliseconds from head cue time, zero on the head. A follower ignites at head ignition plus fuse. When the frame clock snaps the head, followers move with it and report its drift as theirs.

Quickmatch burns at one rate, so chained beside jitter is an error, same for fire or chase. Past MAX_CHAIN_LENGTH, or with no interval, a run gets refused before any shot exists.

Downstream, keep one idea in your head: one cue, many shots. Anything the panel sees is the head alone. Firing table gets one row and one cue number per run, findEvent by number lands on the head, module load counts one pulse, rehearsal fires one output, wiring runs one lead. Same for moduleLoads, pins rather than shells, diff keys and doubling, which backs a chain up once. Every shell goes up though. Density, rack layout, tube order and permitFacts.shotCount count each one, cueCount beside it counts chains. Candidates skip runs already chained. Change a chain's shot count or fuse spacing and diff calls it a swap.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

Nothing reads `automatic yes` on a signal. Give it meaning.

A signal declared that way is worked by trains, not by a signaller, which holds only
where nothing needs deciding. One route reads from it, and that route calls no points,
in it or in the overlap beyond it. Anything else is a drafting mistake `check` reports
against the signal, under one new error rule, `auto-working`. One rule, no more, and the
changelog count moves with it.

Its route then stands set. Set when a machine is built, and again as soon as track it
wants comes free, a train having left or a signaller having given something up. Asking
for it, cancelling it, releasing it: all refused. None of that is a fault, so rules
working the interlocking stop reporting these routes.

Signaller keeps replacement. `Machine.replace(signal)` puts an automatic signal back to
danger and holds it there, giving its route up the way cancelling does, approach locking
and all. `Machine.work_automatically(signal)` hands it back. Refused for a signal trains
do not work, for one already replaced, and for one nobody took away. Scenarios say
`replace K5` and `automatic K5`, and expect `signal K5 replaced` or `signal K5
automatic`.

`signalbox automatic PLAN` prints each one with the route it works, and for the rest
names the routes it had a choice of or the points wanting moved. `--faults` narrows to
those, `--locks` prints panel moves an automatic route shuts out. It reads rather than
judges, so its status stays zero whatever it found.

Write new scenario words into the reference a runner is checked against.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

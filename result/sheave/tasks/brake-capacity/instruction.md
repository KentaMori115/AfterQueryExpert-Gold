Nothing in sheave knows what brake stands in an engine house. `safety` carries
retardations somebody picked, so `audit` cannot say whether one holds.

Put the brake in `safety`, under exactly these backticked names. A `brake` is
`diameter` of its path, shoe `width`, `arc` one shoe covers in degrees,
`shoes` bearing, lining `friction`, `force` on each shoe. Anything about shoes
alone takes a brake, `torque(brake)` and `pressure(brake)`; everything else
takes the winder it is bolted to, since a winder carries one. `torque` is
friction times force times shoes at path radius. `gripPull` is slack side
times one less than working ratio, least anywhere in a wind; a drum winder
refuses it. `heldPull` refers torque to rope over drum or wheel radius, and on
a wheel takes the lesser of that and grip.

`power` gets three more off a duty: `leastOutOfBalance` and `mostOutOfBalance`
across a wind, both signed, and `worstOutOfBalance`, larger by size. Out of
balance at a point and moving mass are there. `holds` wants three times worst
held at rope; `forceFor` gives shoe force that just does it, shoes alone.

`retardationWinding` adds least, `retardationLowering` takes most off, both
over moving mass, neither below nought. `stopsAnOverwind` puts winding figure
against what `retardationFor` asks of `overwindRoom`. `pressure` is shoe force
over strip of path it covers, in N/mm², and practice stops at 0.7.

Winder file takes one `brake` line wanting all six of those keys, refused
twice or with a word it does not know. `brakeOf` refuses where a sheet said
nothing, and `audit` stays quiet. Otherwise `brake` gets these and no others:
error where it will not hold or stop an overwind, warning past 0.7, note
either way.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

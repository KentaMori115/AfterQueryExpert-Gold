`sheave` treats a winding rope as a string that either holds or does not. It is a spring. A kilometre of it under a loaded skip gives a metre and more. A wind that stops does not stop, it bounces.

Model that in `src/rope`. A `hang({ rope, length, ropes, carried, balance })` is `length` metres of rope from the sheave, `ropes` of them pulling, `carried` kilograms on the end, `balance` kilograms of balance rope beneath. Off one:

- `springRate`, kN a metre. A laid rope keeps 0.55 of steel's modulus, a locked coil one 0.75. Steel area of every rope over the length.
- `wholeStretch`, metres. What hangs on it, and its own weight at half.
- `bounceMass`, kilograms. What is carried, all the balance rope, a third of the winding one.
- `bouncePeriod`, seconds. That mass on that spring.
- `peakPull` and `leastPull`, kN, off a retardation. Mass times retardation, doubled, onto and off what already hung there, a dropped load doing twice a lowered one. `goesSlack` where the second went past nothing. `shockFactor`, the set's breaking load over `peakPull`.

Then `hangAt(winder, up)`, `up` metres above the lowest inset, on `ropeWanted` less `up` of rope with `balance*up` beneath, and `worstShock(winder)` giving `{ up, factor }` for where the rope carries most, braked at the emergency brake, cut for the worst rope of a set as the static factor is. Put it on the design sheet as a `stop` check whose band floors at the factor no rope goes below, in the audit under the rope, an error past it, and in a `bounce` command over `--length`: stretch, period, the factor a stop leaves.

Leave what is in `test/` alone.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

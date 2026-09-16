A site reaches portfire as one number, `--audience 200`. Give it a sheet, shaped like a rig sheet:

    site water meadow
    audience -200 -150 200 -150
    hard river -300 120 300 140
    house mill.cottage at 400 300 limit 120
    limit 115

The `audience` line is the spectator line, two points or more, and a second one is an error. `hard` and `soft` lines are named boundaries, and a `house` is a noise sensitive property, its position after `at` and ceiling after `limit`. A bare `limit` is the sheet's, wherever it stands, taken by any house naming none; with neither a house raises nothing. A bad line raises one error and no more, reading carrying on. Export `parseSite(text, name)` at the package root, returning site and diagnostics; `Site` gains `houses` of `name`, `at` and optional `limit`.

Show commands take `--site <sheet>`; `--audience` beside it is a usage mistake. `permit` and `pack` take the site's name off the sheet unless `--site-name` says. `permit` reports only the closest hard boundary to each position and every house, `plan` marks each house `H` in its key, `crowd` measures frontage off the audience line.

Judge fallout where it lands: the casing falls from break height at `CASING_DESCENT` and drifts downwind, its disc keeping the fallout radius. A hard boundary is crossed when it lies nearer that centre than the radius, or when the flight crossed it; one exactly the radius away is clear. `--wind-from` is where the wind comes from: 180 carries fallout north.

Judge noise at each house with the noise check the package already carries, against that house's own limit. Build on the geometry already in `safety/site.ts`, and leave what the package does today unchanged.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

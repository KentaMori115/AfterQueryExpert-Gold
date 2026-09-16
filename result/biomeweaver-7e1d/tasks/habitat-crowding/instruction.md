Habitat records in a BiomeWeaver capsule already author `capacity`, seats per species, and the run never looks. Make seats bind.

Seats for one species in one region add up over every habitat attached to that region. A season entry named `<species>-capacity` scales that habitat's own seats. Occupancy is headcount across stages, each cohort weighted by the species `space` for its stage: a stage with no entry takes one seat, a stage authored at zero takes no room. Where no habitat on the region seats the species, nothing binds.

Seats are held at step 10 of `docs/tick-phases.md`, after stages advance, so young born this tick and cohorts just promoted count. Past the seats, take the surplus off the cohorts there in proportion to the room each fills, leftovers by cohort key order, rounding as `docs/fixed-point-policy.md` says. Condition of every cohort keeping room is divided by pressure, occupancy over seats.

Each removal writes a population-decrease flow, each condition drop a condition-change flow, cause `habitat-crowding` and rule `<species>.capacity.<region>`. A region past its seats raises an alert naming species and region. The Markdown report gains what crowding took, totalled per species and region.

`biomeweaver pressure` with no run id reports seats season by season, a row per habitat carrying `season`, `species`, `region`, `habitat`, `seats`. Given a run id it reports a row per tick carrying `tick`, `species`, `region`, `occupied`, `seats`, `pressure`. Both honour `--format json`, and `--species` narrows to one.

Seating a species the capsule does not define is an error, so is space for a stage a species lacks, and so is a negative seat or space. Seats no scenario ever fills warn instead.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

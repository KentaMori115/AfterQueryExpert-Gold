# Capsule format

A biome capsule is a directory of authored YAML or JSON records plus a
`biomeweaver.yaml` manifest. Raw model files are immutable during simulation.

The manifest names the biome, calendar, default scenario, include globs, and
fixed-point precision. Include groups are `regions`, `habitats`, `species`,
`resources`, `calendars`, `scenarios`, and `events`.

Seats are authored on the habitat, under `capacity`, keyed by species. What one
individual takes against a seat is authored on the species, under `space`,
keyed by stage.

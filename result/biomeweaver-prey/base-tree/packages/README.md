# Packages

Seed World splits the laboratory into focused TypeScript packages. Each package
owns one concern and depends only on packages below it.

- `@biomeweaver/fixed-point` — scaled integer arithmetic and remainder assignment
- `@biomeweaver/capsule-source` — discovery, parsers, diagnostics, and digests
- `@biomeweaver/biome-model` — compiled regions, habitats, species, and scenarios
- `@biomeweaver/calendar-engine` — seasons and authored modifiers
- `@biomeweaver/resource-engine` — pools, renewal, demand, and allocation
- `@biomeweaver/population-engine` — cohorts, condition, mortality, and stages
- `@biomeweaver/predation-engine` — authored predator consumption
- `@biomeweaver/tick-runtime` — immutable ticks and documented phase order
- `@biomeweaver/flow-explanations` — attributed flows and cause breakdowns
- `@biomeweaver/run-store` — snapshots, manifests, and integrity checks
- `@biomeweaver/biome-reports` — JSON, CSV, and Markdown reports
- `biomeweaver` — public TypeScript library
- `@biomeweaver/cli` — offline command line

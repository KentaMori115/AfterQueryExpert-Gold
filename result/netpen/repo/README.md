# Netpen

Stock, feed, sea lice and water quality for a marine salmon site.

A grow-out site is a handful of pens, a licence it may not exceed, and a
temperature record that decides how fast everything in them grows. Netpen
carries the stock ledger those figures are derived from, budgets growth against
accumulated degree-days, tracks the two feed conversion ratios that get quoted
interchangeably and should not be, and holds the lice count against whichever
regulatory limit is in force that week. What comes out of it is the answer to
the question the site actually asks: how much biomass is in the water right
now, and what is about to stop us.

## What it does

- **Stock ledger** — every figure about a pen derived from its event log rather
  than stored, with mean weight carried forward between weighings on the
  group's own growth coefficient and the temperature that actually happened.
- **Growth** — the thermal growth coefficient model on cube-root weight against
  degree-days, with the fitted value from the pen's history preferred to the
  feed supplier's table.
- **Biomass** — standing biomass against the site licence, and density per pen,
  which is the limit that bites after stock is consolidated into fewer pens.
- **Feed** — biological and economic FCR computed from the same inputs so the
  gap between them stays visible, because that gap is the cost of the mortality.
- **Lice** — the Norwegian single limit with its tightened spring window, and
  the two-level Scottish regime, resolved by ISO week.
- **Water** — dissolved oxygen as both concentration and saturation, on the
  Garcia and Gordon refit of Benson and Krause for sea water.
- **Health** — mortality as a rate against a population recomputed from the
  record, split by cause, plus treatment history.
- **Harvest** — size bands on gutted weight from a lognormal spread, and quality
  grade estimated separately, combined only at settlement.
- **Alerts** — rules that derive the set that ought to be open from current
  state, reconciled against what already is, so a standing breach is not raised
  again on every dashboard load.

## Running it

```
npm install
npm run dev        # demonstration dataset, no server needed
npm run verify     # format, lint, types, tests
npm run build
```

## Configuration

Copy `.env.example`. `VITE_BACKEND=demo` runs entirely in-process;
`VITE_BACKEND=http` requires `VITE_API_BASE_URL` and refuses anything but https
away from localhost. `VITE_SITE_CODE` names the site the deployment is for, and
`VITE_CLOCK_TICK_MS` is deliberately coarse.

## Shape of the code

```
src/domain/   the biology and the regulations. no framework, no clock, no deps
src/data/     the API port, its two implementations, projections and fixtures
src/app/      clock, config, routing, queries, connection state
src/ui/       presentation primitives, charts included
src/views/    screens, assembled from the above
tests/        every test in the project, mirroring the source tree
```

`tests/architecture.test.ts` enforces this rather than leaving it to habit: the
domain may not import from app, data or UI, may not pull in a third-party
runtime dependency, may not contain Vue, and may not read the clock. Screens may
name domain types but not run domain rules, and may not reach past the API port
into the fixtures. Every domain module has to open with a block comment saying
what it is for, and every one needs a test file mirroring it.

The clock rule is the one that earns its keep. Every domain function takes the
instant it acts on, so a test and a screenshot can both be pinned to a fixed
date and stay pinned. A single `Date.now()` inside a growth projection would
make the whole suite quietly time-dependent.

## Units

Mass is stored in grams throughout and converted only for display. A site deals
in three scales at once — a fish in grams, a pen in tonnes, kilogrammes for
everything between — and a factor of a thousand in the wrong direction is the
commonest arithmetic mistake on a stock sheet. Grams because nothing measured
is smaller, so no quantity is ever a fraction of its storage unit, and a whole
site at licence is around 5e12 g against a safe integer range of 9e15.

Oxygen is the other pair that gets confused. Concentration in mg/L is what a
probe reads; saturation is what the fish experience, because the gradient
across a gill is a partial pressure. Cold water at 8 mg/L is a comfortable 80
percent and warm water at the same 8 mg/L is supersaturated, so the two are
separate quantities with separate functions.

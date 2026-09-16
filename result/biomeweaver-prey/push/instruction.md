Predation is first come, first served. `applyPredation` walks predator cohorts in sort
order, each taking what it wants off a running prey count, so the first of two cohorts
hunting one prey cohort empties it and later ones go without. Settle a whole tick at
once instead.

Every predator cohort asks each prey cohort in its region for `count x perPredatorPerTick`
prey, half-even at model scale, against counts as the phase began. A rule may carry
`saturation`, the prey count at which a predator takes half what plentiful prey gives:

```text
ask = count x perPredatorPerTick x prey / (prey + saturation)
```

rounded half-even once. A species may carry `maxIntakePerTick`, holding a cohort to
`count x maxIntakePerTick` prey across all its rules. Leave it out and nothing holds it. A
negative in either field is an error. A species that caps intake and hunts nothing earns a
warning, not an error.

Asks settle in rounds. A prey cohort offers what it still holds to the claims still wanting
it: whole where those asks fit, else split across them in proportion through
`proportionalShares` and `assignRemainders`. Each capped predator then trims what it
collected to its remaining budget, in proportion, through the same helpers. Take what
survives, go again, and stop when a round moves nothing. Remainder keys and removal
order both run ascending on `<predator>:<predatorStage>:<region>:<prey>:<preyStage>`, and a
claim that took nothing goes unreported.

Beside removals, report one row per hunted prey cohort:

```text
pressure: { prey, stage, region, asked, taken }
```

ordered by `<prey>:<preyStage>:<region>`. A predator left short of its ask ends the
phase with condition blended toward the share it got, three parts old to one new.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

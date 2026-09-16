# Predation

Predation runs once a tick, after mortality and before reproduction. Every
predator cohort meets every prey cohort in its own region, and Seed World
settles all of those meetings together rather than one predator at a time.

## Asks

A predation rule names a prey species, a prey stage, and `perPredatorPerTick`.
The ask a predator cohort makes on one prey cohort is

```text
ask = count x perPredatorPerTick
```

rounded half-even at model scale. Counts are read once, as the phase begins, so
a predator that is itself hunted asks for the same amount whether it is settled
early or late.

A rule may also carry `saturation`, a prey count at which one predator takes
half what it would take from crowded prey:

```text
ask = count x perPredatorPerTick x prey / (prey + saturation)
```

rounded half-even once, with `prey` the prey cohort's count as the phase began.
Thin prey are therefore harder to find than plentiful prey. A rule without the
field asks for the plain product.

## Budgets

A species may author `maxIntakePerTick`. A cohort of that species may take

```text
budget = count x maxIntakePerTick
```

prey individuals in the tick, again half-even at model scale, counting every
prey it hunts together. A species without the field has no budget and is held
only by what its prey holds.

## Settlement

Asks are settled in rounds.

1. A round looks at claims that still want prey, whose prey still holds
   something, and whose predator still has budget left.
2. Each prey cohort offers what it still holds. When the asks it faces fit
   inside that, every claim is offered what it asked. Otherwise the prey splits
   what it holds across those claims in proportion to the asks, through
   `proportionalShares` and `assignRemainders`.
3. Each budgeted predator then trims the offers it collected to what is left of
   its budget, in proportion to those offers, through the same two helpers.
4. What survives is taken. A round that moves nothing ends the settlement.

Remainders are assigned in ascending key order, the key being

```text
<predator>:<predatorStage>:<region>:<prey>:<preyStage>
```

and the removals a tick reports are ordered by that same key. A claim that took
nothing is not reported.

## Going hungry

A predator cohort that ends the settlement with less than it asked for has its
condition blended toward the share it got, three parts old condition to one part
new, exactly as a cohort short of a resource has. A cohort that got everything
it asked for keeps the condition it arrived with.

## What a tick reports

A tick reports one removal per claim that took something, and beside them one
pressure row per prey cohort that was hunted at all, carrying what was asked of
that cohort and what it lost. Pressure rows are ordered by

```text
<prey>:<preyStage>:<region>
```

so a cohort that faces more than it can feed is visible even when the removals
are spread across several predators.

## Worked example

Two lynx cohorts hunt one hare cohort of 100 in `northern-basin`. The adults
ask for 90, the juveniles for 60, and the adults are capped at 40.

The first round faces 150 asks against 100 hares, so the hares split in
proportion: 60 to the adults, 40 to the juveniles. The adults are over budget
and trim to 40, so the round takes 40 and 40 and leaves 20 hares standing.

The second round drops the adults, whose budget is spent. The juveniles still
want 20 and the hares hold 20, so the juveniles take all of it. The third round
finds nothing to move and stops: the adults took 40, the juveniles 60, and the
hare cohort is empty.

## A second example, with saturation

One lynx cohort of 10 hunts a hare cohort of 50 under a rule that saturates at 50. The flat rate would ask for 10 hares. Saturation halves it, because the prey
standing is exactly the saturation count:

```text
ask = 10 x 1 x 50 / (50 + 50) = 5
```

so the cohort asks for 5, takes 5, and the hares end the phase 45 strong. Push
the hare cohort up to a million and the same rule asks for the flat 10 again:
saturation only bites while prey are thin.

## Budgets across two prey

A lynx cohort of 20 hunts hares at 3 and beetles at 1, capped at 2 prey a head.
Both prey cohorts are plentiful, so the first round offers the whole asks, 60
hares and 20 beetles. The budget is 40, well short of the 80 offered, and the
trim is proportional rather than even: 30 hares and 10 beetles. The budget is
spent, the second round drops the cohort, and the settlement ends there.

A cohort that walks away short pays for it in condition, whether the shortfall
came from its budget or from prey that ran out first.

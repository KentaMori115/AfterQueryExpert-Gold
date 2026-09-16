Standing biomass says when a site goes over licence, not what to lift.

Add planHarvest in src/domain/harvest/schedule.ts. Ask it for a plan:

    { at, maxBiomassT, weeklyCapacityT, minHarvestWeightG,
      temperatures: [{ at, meanC }],
      pens: [{ penId, number, tgc, conditionFactor, events, treatments }] }

    { bookings: [{ penId, week, tonnes, guttedT, meanWeightG }],
      weeklyBiomassT: [], shortfall: { week, excessT }, skipped: [penId] }

Temperatures are daily means, forecast past the record. Week w ends w+1 weeks
after at, and what a pen holds there is what the stock ledger folds out of its
log on that tgc.

A licence counts live. A boat and a contract count gutted, on the pen's own
condition rather than a flat yield: weeklyCapacityT and minHarvestWeightG read
gutted, guttedT is what the boat lands, tonnes and meanWeightG stay live.

A log the ledger will not validate is skipped: out of plan and biomass both,
its penId in skipped, lowest number first.

A booked pen stands through its week, gone after; weeklyBiomassT sums what
stands. Over maxBiomassT breaks; level with it does not.

A pen goes in a week where the daily means before that week's end cover every
medicinal withdrawal and it has reached minHarvestWeightG. The boat comes once
a week, one weeklyCapacityT entry each, and takes any pens landing inside it
between them. Of the plans that hold every week, take the one booking fewest
pens, then the latest lifts, read latest first with the lower pen number ahead
inside a week.

Where no plan holds, book nothing and name the first week that breaks and how
far over. Otherwise shortfall is null. Bookings come in week order.

Fitness rules in tests/architecture.test.ts cover what you add.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

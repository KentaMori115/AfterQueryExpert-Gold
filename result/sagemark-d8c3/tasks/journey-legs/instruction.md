estimateTravel answers a trip with one number. Two new modules under src/core/rules.

supply.ts keeps a ration ledger, SupplyState with rations and hungryDays. drawRations(state, mouths) feeds everyone for a day over a fresh ledger, answering state, drawn and short: packs give what they hold, never go into debt, a short evening is one hungry day whatever the shortfall.

journey.ts exports planJourney(plan), over legs, party, start, calendar and rng, where a leg carries name, miles, costPerMile, climate, season and pace, and a party size, milesPerDay, rations and exhaustion.

Days run the same. Roll the sky once from rng through rollWeather for the leg woken on, and the day is worth milesPerDay times that leg's pace, slow three quarters, fast a quarter more, forced half again, times what the weather leaves, halved from exhaustion 2, gone at 5, rounded to a tenth at the end. Spend that down the route, a mile costing costPerMile, later legs on the same pace and sky, rest gone at dusk. Then everyone eats, a severe day spoils one more ration, and the party takes a level for a forced march, another for a hungry evening, capped at 6, biting tomorrow. Dates run from start a day at a time through calendar, legs with no miles are skipped.

Each day is written down: date, legName for whichever leg it started on, severity, allowance for what that day was worth, covered for miles walked, rationsLeft once fed, hungry, and exhaustion the party sleeps on. A day nobody moves is written too, then the walk ends. The trip reports days, arrived, stalled, arrivalDate (the last day walked, else null), milesLeft, rationsLeft, hungryDays and exhaustion, mileage read to a tenth.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

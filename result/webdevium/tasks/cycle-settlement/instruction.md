buildInvoice bills a mid month upgrade wrong, pooling included hours cycle wide, pricing every overrun at the last plan.

settleCycle in lib/ops/billing/settlement.ts closes a cycle period by period. Feed it clientId, cycleStart, cycleEnd, changes, usage, credits, taxBps, planCurrency, currency, ratesCsv. Back come segments, one per stretch prorateCycle marks, each reading:

    { planId: 'starter', hours: 9, allowanceHours: 3.33,
      carriedInHours: 0, overageHours: 5.67,
      subscriptionCents: 4333, overageCents: 8505 }

planId names that stretch's plan, subscriptionCents its prorated figure. allowanceHours is included hours times slice the period covered. An hour counts against period holding it, change instant on new plan. Skip work from another client, outside cycle, or with a repeated id. Negative hours, throw. What a period leaves unspent becomes next carriedInHours, never back; what survives close is unusedAllowanceHours. Overage prices at its own plan rate. Hours read to hundredths, cents whole, halves to even, roundHalfEven's way. Rounding is display only: carry keeps its full value, 4.3333 earned showing 4.33 and handing 4.3333 on.

lines runs period by period, subscription then overage where it ran over, each carrying kind, ref naming plan or balance, cents. Entries convert one by one into currency, segments staying in planCurrency. subtotalCents converts the whole bill once, odd cent landing on heaviest entry.

Balances carry id, remainingCents, expiresAt. They draw bill down into creditsAppliedCents, soonest to lapse first, undated last, smaller before bigger, then id. Lapsed by close sits out. Balances come back in arrival order, credit entries negative. taxCents is taxBps on what is still owed, halves to even again, last as a tax entry. Nothing owing, nothing to tax, and a zero writes no entry. totalCents covers both.

Leave what these modules already do alone.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

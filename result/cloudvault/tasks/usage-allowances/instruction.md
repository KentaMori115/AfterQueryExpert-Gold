Usage gets recorded but never metered.

Four modules under `lib/`. Times are epoch milliseconds; sizes are byte counts, never negative.

```ts
BillingAnchor { anchorDay, startedAt }
BillingPeriod { index, startsAt, endsAt }
UsageEvent { type: "upload"|"download"|"delete"|"list", at, success, fileSize? }
FileRecord { fileId, size, uploadedAt, deletedAt? }
PeriodUsage extends BillingPeriod { requests, bandwidthBytes, peakStoredBytes, closingStoredBytes }
Plan { requestAllowance, bandwidthAllowance, storageLimitBytes, carryPeriods }
PeriodBalance extends BillingPeriod { requestCredit, bandwidthCredit, requestsUsed, bandwidthUsed, requestOverage, bandwidthOverage, storageOverBytes, carriedInRequests, carriedInBandwidth, withinPlan }
ProspectiveRequest { type, at, sizeBytes? }
Decision { verdict: "admit"|"throttle"|"deny", reason: "within_plan"|"storage_full"|"bandwidth_exhausted"|"requests_exhausted"|"outside_subscription", periodIndex, requestsRemaining, bandwidthRemaining, storageRemainingBytes }

billing-period.ts  periodByIndex(anchor, index), periodAt(anchor, at) or null
usage-ledger.ts    buildLedger(anchor, events, files, upTo)
allowance.ts       foldBalances(plan, ledger)
quota-decision.ts  decideRequest(plan, balances, files, request), retryAfterSeconds(balances, at)
```

An `anchorDay` under 1 counts as 1. A month too short for the anchor settles on its last day, and never carries: next month uses the anchor again. Boundaries are UTC midnight, half open; period 0 holds `startedAt`. `buildLedger` meters from `startedAt` through the period holding `upTo`. Period 0 may open before `startedAt`: count nothing earlier, take the peak from `startedAt`.

`requests` counts every event, `bandwidthBytes` covers successful uploads and downloads, a missing size is nothing. Deletions carry no size: read the level off file records, upload inclusive to deletion exclusive; peak includes bytes carried in.

Unspent counters bank into `carriedIn`, capped at `carryPeriods` allowances. A period running over banks nothing; storage never banks.

Weigh storage, then bandwidth, then requests; first to bite decides. Storage and bandwidth `deny`, spent requests `throttle`, else `admit`. Outside every period: `deny`, `outside_subscription`, `periodIndex` -1, remaining figures zero. Remaining figures count credit before serving this request. `retryAfterSeconds` gives whole seconds rounded up to the period close, zero outside.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

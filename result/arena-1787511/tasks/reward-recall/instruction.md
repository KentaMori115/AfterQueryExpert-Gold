ArenaFlow pays a tournament once and can never take it back. `RewardRevoked` is
a declared event nothing appends, and `engine/rewards/claims.ts` exports a
window check nobody calls, so `claimWindowMs` decides nothing.

`revokeReward(rewardId, at, reason)` takes one reward back. Blank reason is an
invalid argument, a reward nobody granted not found, a second revoke a conflict,
and a prize somebody already claimed an illegal state: that one is gone.
`RewardRevoked` lands on `reward:<id>` carrying `rewardId`, `playerId` and
`reason`.

`recallRewards(tournamentId, at, reason)` takes a whole payout back, oldest
reward id first, and answers with what it revoked. A claimed prize anywhere in
that tournament makes it a conflict and nothing moves at all. Nothing left to
take is an empty answer.

Distribution keeps refusing while any reward stands, even when part of the
payout came back. After a recall it runs again as a fresh round: ids gain
`_r2`, then `_r3`, and every earlier round keeps its own records.

Claims honour `claimWindowMs`, counted from `grantedAt`. The deadline still
counts; a millisecond later is an illegal state. `expireClaims(tournamentId,
at)` revokes everything past its deadline, oldest id first, and no window means
nothing expires.

`payoutStatement(tournamentId)` answers `rounds` oldest first, each with
`round`, `grantedAt`, `rewards`, `granted` and `standing`, beside `recalled`,
`outstanding` and `paid`. `rewardBalance(playerId)` answers `playerId`,
`claimed` and `pending`; revoked counts towards neither.

Reach it through `POST /rewards/:id/claim`, `/rewards/:id/revoke`,
`/rewards/recall`, `/rewards/expire`, `GET /rewards/statement/:tournamentId`,
`GET /rewards/:playerId/balance`, matching `sdk.rewards` methods, and
`rewards:claim`, `rewards:revoke --reason`, `rewards:recall --reason`,
`rewards:expire`, `rewards:statement` and `rewards:balance --player`, listed like every other
command. Leave existing tests as they are.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

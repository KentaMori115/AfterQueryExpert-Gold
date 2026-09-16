# ArenaFlow operator handbook

This handbook is the long-form companion to the architecture note. It
explains how an operator, SDK user, or embedding game server should
drive ArenaFlow without introducing non-determinism.

## 1. Mental model

ArenaFlow is a fold. You append facts. You project state. You ask
engines to decide the next legal fact. You never ask the engine what
time it is.

A typical mutation looks like this:

1. Load the relevant aggregates (player, tournament, match, score).
2. Ask the rule engine whether the action is allowed.
3. Ask the scoring or reward engine what the decision is.
4. Ask anti-cheat whether the decision is plausible.
5. Persist the new aggregate.
6. Append an event with the explanation attached.

If any step fails, nothing is appended. Partial writes are not part of
the v1 contract for memory or SQLite adapters used through
`TournamentService`.

## 2. Identifiers

Prefer prefixed ids:

- `plr_` players
- `tnm_` tournaments
- `mch_` matches
- `ssn_` seasons
- `rwd_` rewards
- `evt_` events
- `snp_` snapshots

Ids are opaque strings after validation. Do not encode rank or score
inside an id; those values change.

## 3. Timestamps

Every mutating API takes `createdAt` or `at` as epoch milliseconds.
Tests should use a fixed origin such as `1_700_000_000_000` and add
small integers. Production embeddings should pass the game server's
authoritative match clock, not the API node's clock.

## 4. Players

A player record is immutable. Skill rating defaults to 1000. Level
defaults to 1. VIP is a boolean used by the rule and scoring engines.

Tags are lowercased, trimmed, and unique. Use tags for restrictions
(`smurf`, `banned_region`) rather than inventing parallel fields.

Profiles are projections: wins, losses, draws, streaks, reward counts,
and a chronological history. They are not stored as a separate write
model in v1; `PlayerStateEngine` rebuilds them from scores, tournaments,
and rewards.

## 5. Tournaments

Lifecycle:

`draft -> registration -> active -> completed`

or any non-terminal state `-> cancelled`.

Rules of thumb:

- Registration is the only state that accepts `register` / `unregister`.
- Active is the only state that accepts matches.
- Completed is the only state that accepts reward distribution.
- Starting requires at least two registered players.

Formats change pairing, not the score formula. You can run a
leaderboard cup and an elimination cup with the same `ScoringConfig`.

## 6. Scoring

Default formula:

- win `+100`
- loss `-20`
- draw `+10`
- forfeit `-40`
- every 5-win streak `+50`
- VIP multiplier `1.1` applied to base plus streak

Custom formulas may use `BASE`, `RAW`, `STREAK`, `VIP`, `VIP_MULT`,
`WIN`, `LOSS`, `DRAW`, and `FORFEIT`. Anything else is rejected.

Presets: `standard`, `conservative`, `aggressive`, `casual`.

## 7. Ranking

Default tie-break:

1. total score
2. wins
3. best streak
4. earlier last update
5. lexicographic player id

Alternate strategies drop some of those keys. Movement is always
measured against a published board, never against a discarded
intermediate ranking. That is what `recomputePublished` is for after a
voided match.

## 8. Rules

Eligibility predicates:

- minimum level
- optional maximum level
- optional VIP-only
- banned tags
- allowed tags (empty list means any)
- optional max matches per player

The VIP score modifier is expressed as:

`IF player.vip == true THEN score_multiplier = scoring.vipMultiplier`

## 9. Matchmaking

Pairs closest remaining skill ratings. Teams use a snake draft from
highest skill to lowest. Rating updates use a deterministic Elo step
with k=32. None of these functions call `Math.random`.

## 10. Rewards

Tiers match a rank range. Amount is either a flat `amount` or
`shareOfPool * prizePool`. Distribution is rejected if non-revoked
rewards already exist for the tournament. Claims honor an optional
window.

## 11. Anti-cheat

Blocking findings:

- awarded absolute value above 500
- duplicate submission key
- invalid match status for the attempted action
- completion at or before start when a completion timestamp is supplied
- duplicate event ids when a seen set is supplied

Warning findings:

- win rate at or above 0.98 over at least 8 matches
- repeated opponent beyond a configured limit

Warnings never abort a `TournamentService` submission. Blocks do.

## 12. Seasons

Open an upcoming season at or after `startsAt`. Close an active season
at any later timestamp. When `resetRanksOnClose` is true, the archive
drops published ranks and `resetScores` returns empty score records for
the next season's first tournament.

Progression titles by total score:

- 0 Recruit
- 250 Contender
- 750 Challenger
- 1500 Veteran
- 3000 Elite
- 5000 Champion
- 8000 Legend

## 13. Event journal

Sequences start at 1 and increase by one. Duplicate event ids fail.
Replay fails closed on unknown types and on sequence gaps. Snapshots
store serialized maps plus `lastSequence`. Restore then replay
`readFrom(lastSequence + 1)`.

## 14. Persistence

Memory: in-process maps. Default for tests and CLI.

SQLite: Node.js 24 `node:sqlite`. Schema stores events, snapshots, and
JSON documents for players, tournaments, matches, scores, rewards, and
seasons. No network service is required.

## 15. API, SDK, CLI

The HTTP layer is a thin translator. Integration tests call the router
directly. The SDK can wrap that router or a remote `baseUrl`. The CLI
parses `--flag value` pairs and currently constructs an isolated memory
arena per invocation so it stays dependency-free.

## 16. Testing doctrine

- No `Date.now()`
- No `Math.random()`
- No network
- No sleeps
- Same inputs, same assertions

## 17. Embedding checklist

1. Create players before tournaments.
2. Open registration before register.
3. Start before matches.
4. Start a match before submitting a result.
5. End before distributing rewards.
6. Pass the same timestamps if you ever replay the journal in a tool.

## 18. Failure mapping

| Engine error | Typical HTTP |
| --- | --- |
| InvalidArgumentError | 400 |
| NotFoundError | 404 |
| ConflictError | 409 |
| IllegalStateError | 409 |
| IneligibleError | 403 |
| AntiCheatError | 403 |
| RuleViolationError | 403 |

## 19. Worked scoring example

Player B is VIP. She wins a started match against A.

- base 100
- streak 1, no bonus
- VIP 1.1
- awarded 110

Leaderboard: B first with 110, A second with -20.

## 20. Worked reward example

Prize pool 1000. Gold 70% for rank 1, silver 30% for rank 2.

- B receives 700 gold
- A receives 300 silver

A second `distribute` call conflicts until existing rewards are
revoked.

# ArenaFlow type and event reference

## Shared types

### PlayerRecord

| Field | Type | Notes |
| --- | --- | --- |
| id | PlayerId | Prefixed identifier |
| displayName | string | 1-48 letters, numbers, spaces, `._'-` |
| createdAt | EpochMillis | Caller supplied |
| skillRating | number | 0-10000, default 1000 |
| level | number | 1-999, default 1 |
| vip | boolean | Enables score multiplier |
| tags | string[] | Normalized unique tags |
| metadata | object | Opaque caller data |

### TournamentRecord

| Field | Type | Notes |
| --- | --- | --- |
| id | TournamentId | Prefixed identifier |
| name | string | 2-80 characters |
| format | TournamentFormat | See formats |
| status | TournamentStatus | draft/registration/active/completed/cancelled |
| seasonId | SeasonId? | Optional season link |
| createdAt | EpochMillis | |
| startedAt | EpochMillis? | Set on first start |
| endedAt | EpochMillis? | Set on complete/cancel |
| capacity | number | 2-10000 |
| registeredPlayerIds | PlayerId[] | Unique |
| scoring | ScoringConfig | Frozen |
| rules | RuleConfig | Frozen |
| rewards | RewardConfig | Frozen |
| metadata | object | |

### ScoringConfig

| Field | Default |
| --- | --- |
| winPoints | 100 |
| lossPoints | -20 |
| drawPoints | 10 |
| forfeitPoints | -40 |
| streakBonusEvery | 5 |
| streakBonusPoints | 50 |
| vipMultiplier | 1.1 |
| customFormula | undefined |

### RuleConfig

| Field | Default |
| --- | --- |
| minLevel | 1 |
| maxLevel | undefined |
| requireVip | false |
| bannedTags | [] |
| allowedTags | [] |
| maxMatchesPerPlayer | undefined |

### MatchRecord

Pending matches have empty results. Started matches keep empty results
until completion. Completed matches have one result per player.

### ScoreRecord

`total` is the running awarded sum. `explanations` is append-only.

### RankingEntry

`movement` is previousRank - rank. Positive means the player moved up.

### RewardRecord

Statuses: granted, claimed, revoked. Pending is reserved for future
async payouts and is not written by v1 engines.

A reward id carries the distribution round that minted it. The first round
writes `rwd_{tournament}_{player}_{tier}` and later rounds append `_r2`,
`_r3`, and so on, so a recalled round keeps its own records instead of being
overwritten by the round that replaces it.

### PayoutStatement

| Field | Type | Notes |
| --- | --- | --- |
| tournamentId | TournamentId | Whose payout this is |
| rounds | PayoutRound[] | Oldest round first |
| recalled | number | Amount revoked across every round |
| outstanding | number | Amount granted and not yet claimed |
| paid | number | Amount claimed |
| explanation | DecisionExplanation | `reward.statement` |

### PayoutRound

| Field | Type | Notes |
| --- | --- | --- |
| round | number | 1 for the first distribution |
| grantedAt | EpochMillis | Earliest grant in the round |
| rewards | RewardRecord[] | Ordered by reward id |
| granted | number | What the round handed out when it ran |
| standing | number | What of it survives, so a recalled round shows 0 |

### RewardBalance

| Field | Type | Notes |
| --- | --- | --- |
| playerId | PlayerId | |
| claimed | number | Total of the player's claimed rewards |
| pending | number | Total of the player's granted rewards |

Revoked rewards count towards neither figure.

### SeasonRecord

`resetRanksOnClose` defaults to true.

## Domain events

Each event has `id`, `type`, `at`, `streamId`, `sequence`, `payload`,
and `explanation`.

### PlayerCreated

Stream `player:{id}`. Payload: playerId, displayName, skillRating,
level, vip.

### PlayerRegistered / PlayerUnregistered

Stream `tournament:{id}`. Payload: playerId, tournamentId.

### TournamentCreated

Stream `tournament:{id}`. Payload: tournamentId, name, format,
optional seasonId.

### TournamentOpened / TournamentStarted / TournamentEnded

Stream `tournament:{id}`. Payload: tournamentId.

### TournamentCancelled

Adds `reason`.

### MatchCreated

Stream `match:{id}`. Payload: matchId, tournamentId, playerIds.

### MatchStarted / MatchCompleted / MatchVoided

Stream `match:{id}`. Voided includes reason.

### ScoreSubmitted

Stream `match:{id}`. Payload includes outcome, rawScore, awarded.

### PenaltyApplied

Stream `player:{id}`. Amount is stored positive; projector subtracts it.

### RewardGranted / RewardClaimed / RewardRevoked

Stream `reward:{id}`.

### SeasonOpened / SeasonClosed

Stream `season:{id}`.

### SnapshotTaken

Stream `system`. Payload: snapshotId, lastSequence.

### AntiCheatFlagged

Stream `player:{id}`. Payload: code, severity, optional tournamentId.

## Service methods

`TournamentService` is the supported orchestration facade.

- createPlayer
- createTournament
- openRegistration
- register
- start
- end
- cancel
- createMatch
- startMatch
- submitPairResult
- leaderboard
- rankingsFor
- distributeRewards
- claimReward
- revokeReward
- recallRewards
- expireClaims
- payoutStatement
- rewardBalance
- profile
- listRewards
- listTournaments
- supportedFormats

## HTTP routes

See `docs/api.md`. Path parameters are decoded. Unknown routes return
404 JSON. Thrown `ArenaFlowError` values are mapped to HTTP statuses.

## SDK classes

- ArenaFlowClient
- ArenaFlowSdk
- TournamentApi
- PlayerApi
- MatchApi
- RankingApi
- RewardApi

`ArenaFlowSdk.inMemory()` constructs a memory-backed router client.

## CLI commands

See `docs/cli.md`. `availableCommands()` is the programmatic list.

## Persistence tables (SQLite)

- events
- snapshots
- players
- tournaments
- matches
- scores
- rewards
- seasons

Documents are JSON text. Events are decomposed into columns plus JSON
payload and explanation.

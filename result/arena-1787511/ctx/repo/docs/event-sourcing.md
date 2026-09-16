# Event sourcing and replay

ArenaFlow stores every meaningful competition change as an immutable
domain event. Current state is a fold over that journal. This makes
scoring, rankings, rewards, and anti-cheat decisions reconstructable.

## Why events

Identical inputs and an identical journal always produce identical
results. The engines never read wall-clock time or generate random
values. Callers supply timestamps, identifiers, and match payloads.

Replay is the source of truth for audits:

- Why did a player receive 110 points instead of 100?
- Why did two players with the same score receive different ranks?
- Why was a reward withheld?

Each event carries a structured `explanation` with a machine-readable
code, a human-readable message, and deterministic details.

## Event catalog

| Event | Stream | Meaning |
| --- | --- | --- |
| PlayerCreated | `player:{id}` | A competitor entered the platform |
| PlayerRegistered | `tournament:{id}` | A player joined a tournament |
| PlayerUnregistered | `tournament:{id}` | A player left during registration |
| TournamentCreated | `tournament:{id}` | Tournament definition captured |
| TournamentOpened | `tournament:{id}` | Registration opened |
| TournamentStarted | `tournament:{id}` | Matches may now be recorded |
| TournamentEnded | `tournament:{id}` | Final rankings freeze |
| TournamentCancelled | `tournament:{id}` | Competition abandoned |
| MatchCreated | `match:{id}` | Pairing or grouping created |
| MatchStarted | `match:{id}` | Match became live |
| ScoreSubmitted | `match:{id}` | Awarded points for one participant |
| MatchCompleted | `match:{id}` | All participant results sealed |
| MatchVoided | `match:{id}` | Result discarded |
| PenaltyApplied | `player:{id}` | Anti-cheat or rule penalty |
| RewardGranted | `reward:{id}` | Prize allocated |
| RewardClaimed | `reward:{id}` | Prize marked claimed |
| RewardRevoked | `reward:{id}` | Prize withdrawn |
| SeasonOpened | `season:{id}` | Season became active |
| SeasonClosed | `season:{id}` | Season archived, optional rank reset |
| SnapshotTaken | `system` | Compact checkpoint of folded state |
| AntiCheatFlagged | `player:{id}` | Suspicion recorded |

## Journal contract

The journal is append-only. Sequences are monotonic integers starting at
1. Duplicate event ids are rejected. Streams partition events by
aggregate so a single tournament or player can be replayed without
reading the entire history.

```
append(event) -> assigned sequence
readAll()
readStream(streamId)
readFrom(sequence)
```

## Replay

Replay applies events in sequence order to a projector. Projectors are
pure functions: `(state, event) -> state`. The default projector
rebuilds players, tournaments, matches, scores, rankings, rewards, and
seasons.

Replay must ignore unknown future event types only when an explicit
compatibility flag is set. v1 fails closed: an unknown type is a replay
error.

## Snapshots

A snapshot is a frozen copy of projected state plus the last applied
sequence. Restore loads the snapshot, then replays `readFrom(lastSequence + 1)`.

Snapshots are optional. An empty snapshot store still yields a correct
system by replaying the full journal.

## Determinism rules

1. Never call `Date.now()` or `Math.random()` inside engines.
2. Maps and sets are projected into sorted arrays before ranking.
3. Tie-breaks are explicit: score, wins, streak, earlier update, then id.
4. Custom scoring formulas may only use a closed token set.
5. Tests must use fixed timestamps.

## Historical reconstruction

Given a journal and an optional snapshot:

1. Restore snapshot state if present.
2. Replay remaining events.
3. Recompute live leaderboards from projected scores.
4. Re-run reward qualification against the reconstructed ranks.

The reconstructed decision explanations must match the original event
payloads. If they do not, the projector and the engine have diverged and
the replay is rejected.

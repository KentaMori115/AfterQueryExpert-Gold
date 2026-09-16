# Architecture

ArenaFlow is a deterministic competition engine. Game clients, casino
backends, and mobile event services send player actions and match
results. ArenaFlow evaluates rules, scores matches, updates rankings,
distributes rewards, and records every decision as an event.

## Layers

1. **API / SDK / CLI** – interchangeable surfaces over one service.
2. **Tournament Service** – orchestrates registration, matches, and payouts.
3. **Engines** – scoring, ranking, rules, matchmaking, rewards, anti-cheat.
4. **Player State + Season Manager** – profiles and seasonal progression.
5. **Event Journal + Replay + Snapshots** – historical reconstruction.
6. **Persistence** – memory for tests, SQLite for local durability.

## Determinism

Engines never read wall-clock time or generate random numbers. Callers
supply timestamps, identifiers, and payloads. Tie-breaks are explicit.
Custom formulas use a closed token grammar.

## Explainability

Every score, rank, reward, and anti-cheat decision carries:

- `code` – stable machine identifier
- `message` – human-readable reason
- `details` – structured evidence

## Formats

- Leaderboard: cumulative scores
- Round robin: all-play-all schedule
- Elimination: power-of-two bracket
- Team: snake-draft balance and team totals
- Time challenge: remaining-time bonus on raw score

## Payouts

A tournament pays once. A payout that went out against the wrong numbers is
recalled whole and paid again as a new round, and every round keeps its own
records, so the ledger reads as a history rather than a current balance.

## Persistence choices

Memory persistence keeps maps in process and is the default for tests.
SQLite persistence uses Node.js 24 `node:sqlite` so no native addon or
external database process is required.

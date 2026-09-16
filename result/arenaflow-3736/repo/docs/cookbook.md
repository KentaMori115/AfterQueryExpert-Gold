# ArenaFlow cookbook

Copy-and-adapt these recipes. Every example is deterministic: timestamps
are literals and no external service is required.

## In-process weekend cup

```ts
import { MemoryPersistence } from "arenaflow";
import { TournamentService } from "arenaflow";

const T0 = 1_720_000_000_000;
const store = new MemoryPersistence();
const arena = new TournamentService(store);

arena.createPlayer({ id: "plr_ann", displayName: "Ann", createdAt: T0 });
arena.createPlayer({ id: "plr_ben", displayName: "Ben", createdAt: T0, vip: true });
arena.createTournament({
  id: "tnm_weekend",
  name: "Weekend Cup",
  format: "leaderboard",
  createdAt: T0,
  rewards: {
    prizePool: 1000,
    tiers: [
      { name: "gold", minRank: 1, maxRank: 1, amount: 700, shareOfPool: undefined },
      { name: "silver", minRank: 2, maxRank: 2, amount: 300, shareOfPool: undefined },
    ],
    claimWindowMs: undefined,
  },
});
arena.openRegistration("tnm_weekend", T0 + 1);
arena.register("tnm_weekend", "plr_ann", T0 + 2);
arena.register("tnm_weekend", "plr_ben", T0 + 3);
arena.start("tnm_weekend", T0 + 4);
arena.createMatch({
  id: "mch_final",
  tournamentId: "tnm_weekend",
  playerIds: ["plr_ann", "plr_ben"],
  createdAt: T0 + 5,
});
arena.startMatch("mch_final", T0 + 6);
arena.submitPairResult({
  matchId: "mch_final",
  winnerId: "plr_ben",
  loserId: "plr_ann",
  at: T0 + 7,
});
arena.end("tnm_weekend", T0 + 8);
arena.distributeRewards("tnm_weekend", T0 + 9);
```

Ben is VIP, so a standard win is `100 * 1.1 = 110`. Ann receives `-20`.
Gold pays Ben 700.

## SDK in-memory client

```ts
import { ArenaFlowSdk } from "arenaflow/sdk";

const sdk = ArenaFlowSdk.inMemory();
await sdk.players.create({ id: "plr_a", displayName: "Ann", createdAt: 1 });
await sdk.tournaments.create({
  id: "tnm_cup",
  name: "Cup",
  format: "leaderboard",
  createdAt: 1,
});
```

## Replay after a crash

```ts
const snapshot = store.checkpoint(T0 + 100);
const restored = store.snapshots.restore(snapshot.id);
// then replayJournal(store.journal, { fromState: restored })
```

## Custom formula

```ts
scoring: { customFormula: "BASE + RAW + STREAK" }
```

Allowed tokens: `BASE RAW STREAK VIP VIP_MULT WIN LOSS DRAW FORFEIT`.

## VIP-only invitational

Set `rules.requireVip = true` and `rules.minLevel = 5`. Non-VIP
registrations throw `IneligibleError`.

## Elimination eight

Use `seededBracket(playerIds)` then create one match per occupied slot.
Advance winners with `advanceWinner`.

## Round robin six

`roundRobinSchedule` yields 15 matches for six players. Record them in
any order; ranking uses totals, not match order.

## Team clash

`assignTeams(players, 2)` snake-drafts two sides. Rank with
`teamStandings` after individual scores exist.

## Time challenge

`timeChallengeScore(raw, elapsed, duration)` adds a remaining-time
bonus. Reject submissions where `isWithinWindow` is false.

## Anti-cheat duplicate

Submitting the same `(matchId, playerId, outcome, rawScore)` twice
throws `AntiCheatError`. Void the match and create a new one instead.

## Season reset

```ts
const archive = seasonManager.close(season, at, leaderboard.entries);
const zeros = seasonManager.resetScores(tournamentId, playerIds, at + 1);
```

## SQLite durability

```ts
import { SqlitePersistence, TournamentService } from "arenaflow";
const store = new SqlitePersistence("./arenaflow.sqlite");
const arena = new TournamentService(store);
```

Remember to `store.close()` when the process exits.

## CLI sketch

```bash
arenaflow player:create --id plr_ann --name Ann --at 1720000000000
arenaflow tournament:create --id tnm_weekend --name "Weekend Cup" --at 1720000000000
```

Each CLI process has an isolated memory arena. Embed `TournamentService`
for multi-command durable sessions.

## HTTP against the in-process router

```ts
import { createArena } from "arenaflow";
const { router } = createArena();
await router.handle("POST", "/players", { id: "plr_a", displayName: "Ann", createdAt: 1 });
```

This is how the integration tests work. No listen socket is required.

## Explainability dump

Every `ScoreRecord.explanations` and `RankingEntry.explanation` can be
serialized to an audit UI. Do not invent a second reason string in the
game client; display the engine's message.

## What not to do

- Do not call `Date.now()` inside a custom formula helper you add later.
- Do not shuffle pairings with `Math.random`.
- Do not start a tournament with one player.
- Do not distribute rewards twice without revoking.
- Do not complete a pending match.
- Do not register after start.

## Withdrawing a result

```ts
const store = new MemoryPersistence();
const arena = new TournamentService(store);
// ... players registered, tournament started ...
arena.createMatch({ id: "mch_2", tournamentId: "tnm_cup", playerIds: ["plr_ann", "plr_ben"], createdAt: T0 + 10 });
arena.startMatch("mch_2", T0 + 11);
arena.submitPairResult({ matchId: "mch_2", winnerId: "plr_ann", loserId: "plr_ben", at: T0 + 12 });

const withdrawal = arena.voidMatch({
  matchId: "mch_2",
  reason: "opponent disconnected",
  at: T0 + 20,
});
withdrawal.rebuilt.map((score) => [score.playerId, score.total]);
```

Ann and Ben are rebuilt from whatever else they played in `tnm_cup`. If
`mch_2` was Ann's only match she keeps a record reading zero, stamped
`T0 + 20`. Anyone who never met either of them is left alone.

The rebuild runs the scoring config again rather than subtracting what was
awarded, so a win that paid a five-win streak bonus stops paying it once the
win before it is withdrawn. Replaying the journal afterwards reaches the same
numbers.

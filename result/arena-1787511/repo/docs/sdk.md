# TypeScript SDK

The SDK can talk to an in-process router (recommended for tests) or an
HTTP base URL.

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

## Surfaces

- `sdk.players` – create, profile, history
- `sdk.tournaments` – create, open, register, start, end
- `sdk.matches` – create, start, submitResult
- `sdk.rankings` – leaderboard, forPlayer
- `sdk.rewards` – distribute, forPlayer, claim, revoke, recall, expire, statement, balance

Failed requests throw `ArenaFlowRequestError` with `status` and `body`.

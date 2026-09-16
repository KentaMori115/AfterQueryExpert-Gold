# CLI

```bash
arenaflow help
arenaflow version
arenaflow player:create --id plr_a --name Ann --at 1700000000000
arenaflow tournament:create --id tnm_cup --name Cup --at 1700000000000
arenaflow tournament:open --id tnm_cup --at 1700000000001
arenaflow tournament:register --id tnm_cup --player plr_a --at 1700000000002
arenaflow tournament:start --id tnm_cup --at 1700000000003
arenaflow match:create --id mch_1 --tournament tnm_cup --players plr_a,plr_b --at 1700000000004
arenaflow match:result --id mch_1 --winner plr_a --loser plr_b --at 1700000000005
arenaflow leaderboard --id tnm_cup
arenaflow rewards:distribute --id tnm_cup --at 1700000000006
```

Each invocation currently uses an isolated in-memory arena, which keeps
the CLI deterministic and free of external services. Embed the
`TournamentService` for durable workflows.

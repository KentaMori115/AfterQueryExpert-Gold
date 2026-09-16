# ArenaFlow

ArenaFlow is a TypeScript competitive gaming infrastructure engine that
manages tournaments, matchmaking, scoring, rankings, rewards, anti-cheat
decisions, and season progression through deterministic rules, event
sourcing, and replayable game events.

It is not a game itself. It is the backend platform behind competitive
gaming systems such as esports competitions, casino tournaments, mobile
game events, fantasy competitions, and loyalty challenges.

## Design principles

- **Deterministic**: identical inputs and state always produce identical results.
- **Event-driven**: important changes are stored as replayable events.
- **Rule-based**: tournament behavior is configurable.
- **Explainable**: every score, ranking, and reward decision has a reason.
- **Extensible**: new tournament formats and scoring systems can be added.
- **Testable**: no external game servers or real-time dependencies are required.

## Architecture

```
API / SDK / CLI
       |
Tournament Service
       |
--------------------------------
|        |        |             |
Event   Ranking  Rule        Reward
Engine  Engine   Engine      Engine
       |
Player State Engine
       |
Season Manager
       |
Event Journal + Replay
       |
Persistence
(Memory / SQLite)
```

## Supported tournament formats

- Leaderboard
- Round robin
- Elimination bracket
- Team competition
- Time-based challenges

## Public API

### Tournament

- `POST /tournaments`
- `GET /tournaments/:id`
- `POST /tournaments/:id/register`
- `POST /tournaments/:id/start`
- `POST /tournaments/:id/end`

### Player

- `POST /players`
- `GET /players/:id/profile`
- `GET /players/:id/history`

### Match

- `POST /matches`
- `POST /matches/:id/result`

### Ranking

- `GET /leaderboards/:id`
- `GET /rankings/:playerId`

### Rewards

- `POST /rewards/distribute`
- `GET /rewards/:playerId`

## Development

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
```

Requires Node.js 24 or later. No external services are required.

## Documentation

- [Architecture](docs/architecture.md)
- [Event sourcing](docs/event-sourcing.md)
- [REST API](docs/api.md)
- [TypeScript SDK](docs/sdk.md)
- [CLI](docs/cli.md)
- [Operator handbook](docs/handbook.md)
- [Type reference](docs/reference.md)
- [Cookbook](docs/cookbook.md)

## License

MIT. Copyright 2026 Redacted Author.

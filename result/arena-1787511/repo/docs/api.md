# REST API

All mutation endpoints accept JSON and require caller-supplied timestamps
in epoch milliseconds.

## Health

`GET /health`

## Players

`POST /players`

```json
{ "id": "plr_a", "displayName": "Ann", "createdAt": 1700000000000, "vip": false }
```

`GET /players/:id/profile`

`GET /players/:id/history`

## Tournaments

`POST /tournaments`

```json
{ "id": "tnm_cup", "name": "Cup", "format": "leaderboard", "createdAt": 1700000000000 }
```

`GET /tournaments/:id`

`POST /tournaments/:id/open` `{ "at": 1700000000001 }`

`POST /tournaments/:id/register` `{ "playerId": "plr_a", "at": 1700000000002 }`

`POST /tournaments/:id/start` `{ "at": 1700000000003 }`

`POST /tournaments/:id/end` `{ "at": 1700000000004 }`

## Matches

`POST /matches`

```json
{ "id": "mch_1", "tournamentId": "tnm_cup", "playerIds": ["plr_a", "plr_b"], "createdAt": 1700000000005 }
```

`POST /matches/:id/start` `{ "at": 1700000000006 }`

`POST /matches/:id/result`

```json
{ "winnerId": "plr_a", "loserId": "plr_b", "at": 1700000000007 }
```

## Rankings

`GET /leaderboards/:id`

`GET /rankings/:playerId`

## Rewards

`POST /rewards/distribute` `{ "tournamentId": "tnm_cup", "at": 1700000000008 }`

A tournament that already holds rewards nobody took back answers 409. Once a
payout has been recalled the same call runs again and mints a new round.

`GET /rewards/:playerId`

`POST /rewards/:id/claim` `{ "at": 1700000000009 }`

Answers 409 once the claim window on the tournament's reward config has
closed, and 404 for a reward nobody granted.

`POST /rewards/:id/revoke` `{ "at": 1700000000010, "reason": "anti-cheat" }`

`POST /rewards/recall`

```json
{ "tournamentId": "tnm_cup", "at": 1700000000011, "reason": "pool was wrong" }
```

Answers with every reward it took back, and 409 naming the offenders when one
of the tournament's rewards has already been claimed.

`POST /rewards/expire` `{ "tournamentId": "tnm_cup", "at": 1700000000012 }`

Revokes every reward whose claim window has run out, and answers with them.

`GET /rewards/statement/:tournamentId`

Round by round: what each round granted, what still stands, and what the
tournament has recalled, paid and still owes.

`GET /rewards/:playerId/balance`

## Errors

Domain failures return JSON with `code`, `message`, and `details`.

| Code | HTTP |
| --- | --- |
| NOT_FOUND | 404 |
| CONFLICT / ILLEGAL_STATE | 409 |
| ANTI_CHEAT / INELIGIBLE | 403 |
| INVALID_ARGUMENT | 400 |

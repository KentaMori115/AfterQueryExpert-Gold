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

`POST /matches/:id/void`

```json
{ "reason": "opponent disconnected", "at": 1700000000008 }
```

Withdraws a completed match and rebuilds the scores it fed, answering with
the withdrawal record. The tournament must still be active, and the reason
may not be blank.

## Rankings

`GET /leaderboards/:id`

`GET /rankings/:playerId`

## Rewards

`POST /rewards/distribute` `{ "tournamentId": "tnm_cup", "at": 1700000000008 }`

`GET /rewards/:playerId`

## Errors

Domain failures return JSON with `code`, `message`, and `details`.

| Code | HTTP |
| --- | --- |
| NOT_FOUND | 404 |
| CONFLICT / ILLEGAL_STATE | 409 |
| ANTI_CHEAT / INELIGIBLE | 403 |
| INVALID_ARGUMENT | 400 |

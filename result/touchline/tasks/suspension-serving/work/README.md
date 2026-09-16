# touchline-league-api

The administration service behind a grassroots football league: who is in it, where they play, what
happened on Saturday, and what the table says on Sunday morning.

It exists because the parts of running a league that cause arguments are the parts nobody wants to
keep in a spreadsheet. Two clubs disagree about a scoreline. A player picks up his fifth booking
and nobody notices until he has played a game he should have sat out. Two sides finish level on
points and the secretary has to explain, from the rules, which one went up. This service settles all
three the same way every time.

## Running it

```sh
npm install
npm run check      # typecheck, lint, format, tests
npm run seed       # puts a small league in seed.sqlite
npm run dev        # http://localhost:3000
```

Node 22.5 or later, because the database is `node:sqlite` and `DatabaseSync` arrived in 22.5. There
is no native dependency anywhere in the tree: a clean checkout builds with nothing but npm.

Configuration is read once at startup from the environment, and every value has a working default —
see `.env.example`. `DATABASE_FILE` defaults to `:memory:`, which is what the tests want.

## How it is put together

One directory per domain under `src/modules/<name>/`, and each one is the same six layers:

| File | Holds |
|---|---|
| `<name>.types.ts` | interfaces, enums, the lookup tables, the database row shape and the mapper off it |
| `<name>.schema.ts` | the zod bodies, params and queries |
| `<name>.repository.ts` | SQL, and nothing that could be argued about |
| `<name>.service.ts` | every rule that could be argued about |
| `<name>.controller.ts` | request in, response out |
| `<name>.routes.ts` | which schema guards which path |

The layering is worth keeping strict. When a club disputes a decision the answer is always in one
service file, and it reads as a sentence about football rather than as SQL.

Modules are built in dependency order in `src/app.ts` and handed the services they need, so the
whole wiring of the service is visible in one screen.

## House conventions

These hold everywhere, and the tests lean on them.

**A club is not a team.** A club applies, pays, gets suspended and resigns. A team is the eleven a
club enters into one division for one season. A club with a first team and a reserve side is one
club and two teams, and suspending it suspends both.

**Days are strings, `YYYY-MM-DD`, never timestamps.** The league argues about days, not instants. A
day that is misspelled is a `400`, because the request will not parse. A day that is well formed but
never happened — `2031-02-30` — is a `409`, because the request parsed fine and the calendar is what
refused it. That distinction is deliberate and it is tested on every operation that takes a day.

**Readings take an `asOf`.** The league table and a player's disciplinary record are both computed
on demand for a day you name. Nothing reads the clock. That is what makes last month's table
reproducible next year, and it is why neither is stored.

**Money is whole pence.** Fines are integers. Nothing in the tree stores a float.

**Lists answer `{ items: [...] }`. A single reading answers a bare object.**

**Every body and every query is `.strict()`**, including routes that take no filters of their own.
A caller who invents a field has misread the contract, and answering `200` to a request the service
quietly ignored is worse than refusing it.

## Errors

Every failure answers the same shape:

```json
{ "error": { "code": "conflict", "message": "…", "details": {} } }
```

| Status | Code | Means |
|---|---|---|
| 400 | `bad_request` | the body or query will not parse |
| 401 | `unauthorised` | no bearer token, or one the service does not know |
| 404 | `not_found` | it is not there |
| 409 | `conflict` | it is there, and the league's rules refuse what was asked |
| 500 | `internal` | a bug in this service |

## Who may do what

Every route sits behind a bearer token, including the ones that only read: a league's fixtures and
its disciplinary record are not public. Writes sit behind a scope as well, and the scopes are about
jobs rather than permissions — the person who registers players is not the person who rules on a red
card.

| Role | May write |
|---|---|
| `secretary` | everything |
| `registrar` | registrations: clubs, players, teams |
| `discipline` | cards and rescinding them |
| `readonly` | nothing |

A role that may not write to an area gets a `409`, not a `401`. The caller is who they say they are;
the league just does not let them settle that.

## The endpoints

Full detail, request and response, is in [`docs/api.md`](docs/api.md). In summary:

| Area | Routes |
|---|---|
| Sign in and staff | `/auth/sessions`, `/auth/me`, `/staff` |
| Seasons | `/seasons`, and `open` / `close` |
| Grounds | `/venues`, and `close` / `reopen` |
| Clubs | `/clubs`, and `admit` / `suspend` / `reinstate` / `resign` |
| Divisions | `/seasons/:seasonId/divisions`, `/divisions`, and `fix` / `complete` |
| Teams | `/divisions/:divisionId/teams`, `/teams`, and `withdraw` / `move` |
| Players | `/clubs/:clubId/players`, `/players`, and `release` / `transfer` |
| Fixtures | `/divisions/:divisionId/fixtures`, `/fixtures`, and `postpone` / `abandon` / `reschedule` / `award` |
| Results | `/fixtures/:fixtureId/result`, `/results`, and `confirm` / `dispute` / `settle` |
| The table | `/divisions/:divisionId/table?asOf=` |
| Discipline | `/fixtures/:fixtureId/cards`, `/cards`, `/players/:playerId/record?asOf=` |
| Suspensions | `/players/:playerId/suspensions?asOf=`, `/fixtures/:fixtureId/eligibility` |
| Audit | `/audit` |

## The three rules worth reading the code for

**A score is answered by the side that did not report it.** One club saying a game finished 4–0
proves nothing. The other club confirms it or disputes it, and only a confirmed score moves the
fixture to `played` and reaches the table. A dispute goes to the league, and the score the league
writes down stands whether or not it matches what either side said.

**The table's order goes further than points.** Points, then goal difference, then goals scored, and
only then the games between the two sides involved. Two sides who have never met and are level on
everything fall through to the club name, which is arbitrary but stable — the same results always
produce the same table.

**A card is worth whatever the player's record makes it worth.** A booking on its own is a fine. The
same booking as somebody's fifth of the season carries a one-match ban, and their tenth carries two.
A red card carries its own ban, served alongside the accumulated one rather than added to it. Taking
a card off the record afterwards reworks everything that came after it, because a threshold that was
crossed may no longer be.

**A ban is served in games, by the side that earned it.** Each game the card's side actually plays
serves one match; a walkover, a postponement and an abandoned game serve nothing. A straight ban
starts with the next game, an accumulated one only a fortnight after the card. A player may not be
picked by any side of their club for a game that would serve them a match, which is what
`/fixtures/:fixtureId/eligibility` reads off the day before a game.

## Tests

```sh
npm test
```

Integration tests through supertest, one suite per module, each standing a whole service up against
its own in-memory database so no two tests can see each other's rows. 410 of them.

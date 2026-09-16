# The API, route by route

73 routes. Every one needs `Authorization: Bearer <token>` except `POST /auth/sessions`, which is
how you get a token in the first place. Writes need a scope as well; the scope is named against each
route below, and a caller whose role does not carry it gets a `409`.

Conventions that hold everywhere and are not repeated per route:

- Lists answer `{ "items": [...] }`. A single reading answers a bare object.
- Every body and every query is strict. An unknown field is a `400`, on every route.
- A misspelled day is a `400`. A well-formed day that never happened is a `409`.
- Unknown ids are a `404`, including an id used as a filter.

---

## Signing in

### `POST /auth/sessions`

The only route with no token. Takes `email`, `password`.

`201` gives `token`, `staffId`, `role`, `issuedAt`, `expiresAt`. Sessions last 12 hours.

An unknown address and a wrong password answer identically, so a caller guessing at addresses learns
nothing from the difference. Both are `401`. An account that has been stood down is also `401`.

### `DELETE /auth/sessions/current`

Ends the session the token belongs to. `200` gives `endedAt`. The token stops working immediately.

### `GET /auth/me`

The staff member holding the token: `id`, `email`, `fullName`, `role`, `active`, `createdAt`,
`updatedAt`. Never the password.

---

## Staff — scope `staff`

### `POST /staff`
Takes `email`, `fullName`, `role`, `password` (10 to 200 characters). `role` is one of `secretary`,
`registrar`, `discipline`, `readonly`. `201` gives the staff member. An address somebody already
holds is a `409`.

### `GET /staff`
Filters: `role`, `active`. Ordered by full name, then id.

### `GET /staff/:staffId`
One colleague.

### `PATCH /staff/:staffId`
Takes any of `fullName`, `role`, `active`. An empty body is a `400`. The email cannot be changed.

The league cannot be left without anybody able to run it: changing the role of the last active
secretary, or standing them down, is a `409`.

---

## Seasons — scope `fixtures`

A season carries its own scoring, because leagues do change what a win is worth and last season's
table has to keep using last season's rules.

### `POST /seasons`
Takes `name` (4–80), `startsOn`, `endsOn`, `registrationClosesOn`, and optionally `pointsWin`,
`pointsDraw`, `pointsLoss` (whole, 0–10, defaulting to 3/1/0).

`201` gives `id`, `name`, `startsOn`, `endsOn`, `registrationClosesOn`, `status`, `pointsWin`,
`pointsDraw`, `pointsLoss`, `openedOn`, `closedOn`, `createdAt`, `updatedAt`. Status begins
`planning`, and `openedOn` and `closedOn` are both `null`.

`409` when the season does not end after it starts, when registration closes outside the window,
when the name is taken, or when the window overlaps a season the league already has.

### `GET /seasons`
Filter: `status`. Newest window first.

### `GET /seasons/:seasonId`

### `PATCH /seasons/:seasonId`
Takes any of `name`, `endsOn`, `registrationClosesOn`. The start day cannot be moved. A closed
season is a `409`.

### `POST /seasons/:seasonId/open`
Takes `openedOn`. `planning` becomes `running`. The day has to fall inside the season's own window.

### `POST /seasons/:seasonId/close`
Takes `closedOn`. `running` becomes `closed`, and cannot be before the day it opened.

Transitions are `planning → running → closed` and nothing else.

---

## Grounds — scope `fixtures`

The surface is a lookup rather than a free field, because how many games a pitch takes in a day
depends on it.

| Surface | Games per pitch per day |
|---|---|
| `grass` | 2 |
| `threeG` | 5 |
| `astro` | 4 |

### `POST /venues`
Takes `name` (3–90), `addressLine` (5–160), `postcode`, `surface`, `pitchCount` (whole, 1–12),
`floodlit`.

`201` gives `id`, `name`, `addressLine`, `postcode`, `surface`, `pitchCount`, `floodlit`, `status`,
`closedOn`, `createdAt`, `updatedAt`. Status begins `open`.

The postcode is squared up to upper case as it is stored. A ground is unique on name and postcode
together, so the same name at another postcode is fine.

### `GET /venues`
Filters: `surface`, `status`, `floodlit`. Ordered by name, then id.

### `GET /venues/:venueId`

### `PATCH /venues/:venueId`
Takes any of `name`, `addressLine`, `surface`, `pitchCount`, `floodlit`. The postcode cannot be
changed. A closed ground is a `409`.

### `POST /venues/:venueId/close`
Takes `closedOn`. Keeps the fixtures already in the book, takes no new ones.

### `POST /venues/:venueId/reopen`
No body. Clears `closedOn`. Reopening an open ground is a `409`.

---

## Clubs — scope `registrations`

### `POST /clubs`
Takes `name` (3–90), `shortName` (three or four letters, squared up to upper case), `foundedYear`
(whole, 1850–2100), `contactEmail`, `appliedOn`, and optionally `homeVenueId`.

`201` gives `id`, `name`, `shortName`, `foundedYear`, `contactEmail`, `homeVenueId`, `status`,
`appliedOn`, `admittedOn`, `leftOn`, `createdAt`, `updatedAt`. Status begins `applied`.

A closed home ground is a `409`.

### `GET /clubs`
Filters: `status`, `homeVenueId`. Ordered by name, then id.

### `GET /clubs/:clubId`

### `PATCH /clubs/:clubId`
Takes any of `name`, `contactEmail`, `homeVenueId` (which may be `null` to clear it). The scoreboard
letters cannot be changed. A resigned club is a `409`.

### The four transitions

| Route | Body | From | To |
|---|---|---|---|
| `POST /clubs/:clubId/admit` | `admittedOn` | `applied` | `member` |
| `POST /clubs/:clubId/suspend` | `suspendedOn` | `member` | `suspended` |
| `POST /clubs/:clubId/reinstate` | `reinstatedOn` | `suspended` | `member` |
| `POST /clubs/:clubId/resign` | `leftOn` | any but `resigned` | `resigned` |

Admitting and reinstating both end at `member`, so each names the standing it starts from: an
applicant is admitted, a suspended club is reinstated, and neither word does the other's job.

A club cannot be admitted before it applied, suspended or reinstated before it was admitted, or
leave before it applied.

---

## Teams — scope `registrations`

A team is the eleven a club enters into one division for one season. Ranks, most senior first:
`first`, `reserves`, `third`, `fourth`.

### `POST /divisions/:divisionId/teams`
Takes `clubId`, `rank`, `enteredOn`.

`201` gives `id`, `clubId`, `divisionId`, `rank`, `status`, `enteredOn`, `withdrawnOn`, `createdAt`,
`updatedAt`. Status begins `entered`.

`409` when the club is not a member, when it already has a side of that rank this season, when it
already has a side in this division, when the division is full or is no longer `forming`, or when
the entry would put a senior side below one of the club's own junior sides. That last check runs in
both directions, so it holds however the entries are ordered in time.

### `GET /divisions/:divisionId/teams` and `GET /teams`
Filters: `clubId`, `divisionId`, `rank`, `status`. Ordered by club, then rank, then id.

### `GET /teams/:teamId`

### `POST /teams/:teamId/withdraw`
Takes `withdrawnOn`, which cannot precede the day the side entered. Frees its place in the division.

### `POST /teams/:teamId/move`
Takes `divisionId`. Both divisions have to still be `forming` and in the same season, and every
check that applied on entry applies again.

---

## Players — scope `registrations`

Positions: `goalkeeper`, `defender`, `midfielder`, `forward`.

### `POST /clubs/:clubId/players`
Takes `firstName` and `lastName` (2–60), `bornOn`, `position`, `squadNumber` (whole, 1–99),
`registeredOn`.

`201` gives `id`, `clubId`, `firstName`, `lastName`, `bornOn`, `position`, `squadNumber`, `status`,
`registeredOn`, `releasedOn`, `createdAt`, `updatedAt`. Status begins `registered`.

Age is settled **against the day of registration**, not against today, so a registration that was
legal when it happened stays legal. A player must be 16 that day and not over 70. A squad number is
held by one registered player per club, so a released player frees theirs.

### `GET /clubs/:clubId/players` and `GET /players`
Filters: `clubId`, `position`, `status`. Ordered by last name, then first name, then id.

### `GET /players/:playerId`

### `PATCH /players/:playerId`
Takes any of `firstName`, `lastName`, `position`, `squadNumber`. Date of birth and club cannot be
changed here. A released player is a `409`.

### `POST /players/:playerId/release`
Takes `releasedOn`, which cannot precede the registration.

### `POST /players/:playerId/transfer`
Takes `clubId`, `transferredOn`, `squadNumber`. The record stays one person: the club changes and
the transfer day replaces the registration day. The number has to be free at the receiving club.
Transferring to the club they are already at, or a club that is not a member, is a `409`.

---

## Divisions — scope `fixtures`

Tier 1 is the top and the numbers grow downwards. A tier is held by one division per season.

How many times each pair meets depends on how big the division is:

| Capacity | Rounds |
|---|---|
| up to 6 | 4 |
| 7 to 9 | 3 |
| 10 to 24 | 2 |

### `POST /seasons/:seasonId/divisions`
Takes `name` (3–60), `tier` (whole, 1–8), `teamCapacity` (whole, 4–24), `promotionPlaces` and
`relegationPlaces` (whole, 0–6).

`201` gives `id`, `seasonId`, `name`, `tier`, `teamCapacity`, `promotionPlaces`, `relegationPlaces`,
`status`, `fixedOn`, `completedOn`, `createdAt`, `updatedAt`. Status begins `forming`.

The places going up plus the places going down have to leave somebody where they started, so
`promotionPlaces + relegationPlaces` must be less than `teamCapacity`, or `409`.

### `GET /seasons/:seasonId/divisions` and `GET /divisions`
Filters: `status`, `tier`. Top tier first.

### `GET /divisions/:divisionId`

### `PATCH /divisions/:divisionId`
Takes any of `name`, `teamCapacity`, `promotionPlaces`, `relegationPlaces`. The tier cannot be
moved. A division stops changing once its entries are fixed.

### `POST /divisions/:divisionId/fix`
Takes `fixedOn`, not before the season starts. `forming` becomes `fixed`, which shuts entries and
opens fixtures.

### `POST /divisions/:divisionId/complete`
Takes `completedOn`, not before the day entries were fixed.

---

## Fixtures — scope `fixtures`

### `POST /divisions/:divisionId/fixtures`
Takes `homeTeamId`, `awayTeamId`, `venueId`, `playedOn`, `kickOff` (`HH:MM`, 24 hour).

`201` gives `id`, `divisionId`, `homeTeamId`, `awayTeamId`, `venueId`, `playedOn`, `kickOff`,
`status`, `postponedOn`, `awardedToTeamId`, `awardReason`, `createdAt`, `updatedAt`. Status begins
`scheduled` and the last three are `null`.

`409` when a side plays itself, when either side is not in the division or has withdrawn, when the
day falls outside the season, when the two have already been drawn as often as the division plays or
as often at that ground, when either side is already playing that day, when the ground already holds
as many games as its surface takes, when the ground is closed, or when the division is not `fixed`.

**A kick-off at or after 15:00 needs a ground that can be lit**, or `409`. Grassroots games are
called off rather than finished in the dark.

### `GET /divisions/:divisionId/fixtures` and `GET /fixtures`
Filters: `divisionId`, `teamId`, `venueId`, `status`, `playedOn`. Ordered by day, then kick-off,
then id.

### `GET /fixtures/:fixtureId`

### The four transitions

| Route | Body | From |
|---|---|---|
| `POST /fixtures/:fixtureId/postpone` | `postponedOn`, not after the day it was due | `scheduled` |
| `POST /fixtures/:fixtureId/abandon` | `abandonedOn`, not before it kicked off | `scheduled` |
| `POST /fixtures/:fixtureId/reschedule` | `playedOn`, `kickOff`, optionally `venueId` | `postponed` or `abandoned` |
| `POST /fixtures/:fixtureId/award` | `awardedOn`, `awardedToTeamId`, `reason` | `scheduled`, `postponed` or `abandoned` |

Rescheduling re-runs every check that applied when the game was first put in the book, and clears
`postponedOn`.

Award reasons and the scoreline each records:

| Reason | Winner | Loser |
|---|---|---|
| `noShow` | 3 | 0 |
| `ineligiblePlayer` | 3 | 0 |
| `withdrawal` | 3 | 0 |
| `groundUnfit` | 1 | 0 |

A fixture reaches `played` only by having a result confirmed against it.

---

## Results — scope `results`

### `POST /fixtures/:fixtureId/result`
Takes `homeGoals`, `awayGoals` (whole, 0–99), `reportedByTeamId`, `reportedOn`.

`201` gives `id`, `fixtureId`, `homeGoals`, `awayGoals`, `reportedByTeamId`, `reportedOn`, `status`,
`answeredByTeamId`, `answeredOn`, `settledOn`, `note`, `createdAt`, `updatedAt`. Status begins
`reported` and the four after it are `null`.

Only a side that played may report, only against a `scheduled` game, only once, and not before the
day it was played. The fixture stays `scheduled` until the score is agreed.

### `GET /fixtures/:fixtureId/result` and `GET /results/:resultId`
`404` when no score has been reported.

### `GET /results`
Filters: `divisionId`, `teamId`, `status`. Ordered by the day the games were played.

### `POST /results/:resultId/confirm`
Takes `confirmedByTeamId`, `confirmedOn`. **The side confirming cannot be the side that reported**,
or `409`. Moves the result to `confirmed` and the fixture to `played`.

### `POST /results/:resultId/dispute`
Takes `disputedByTeamId`, `disputedOn`, `note` (4–300). Same rule about who may answer. The fixture
stays `scheduled`.

### `POST /results/:resultId/settle`
Takes `settledOn`, `homeGoals`, `awayGoals`. Only a `disputed` score needs settling. The score the
league writes down stands whether or not it matches what either side reported, and the fixture
becomes `played`.

---

## The table

### `GET /divisions/:divisionId/table?asOf=YYYY-MM-DD`

`asOf` is required. There is no default, because a table that reads the clock cannot be reproduced.

Answers `divisionId`, `seasonId`, `divisionName`, `tier`, `asOf`, `played`, `outstanding`,
`goalsScored`, `complete`, `lines`.

A line carries `position`, `teamId`, `clubId`, `clubName`, `shortName`, `rank`, `played`, `won`,
`drawn`, `lost`, `goalsFor`, `goalsAgainst`, `goalDifference`, `points`, `form`, `placing`.

Only games played on or before `asOf` count, and only confirmed scores and awarded games. `form` is
up to six letters, `W`, `D` or `L`, newest first. `placing` is `promoted`, `safe` or `relegated`,
from the position and the places the division gives out. A side that has withdrawn is left out
entirely. `complete` holds when nothing is outstanding and at least one game has been played.

Points come from the season's own scoring, not from an assumed three for a win.

**The order:** points, then goal difference, then goals scored, then the games between the two sides
involved, then the club name. Two sides who have never met fall through to the name rather than
being treated as level on a head-to-head that does not exist.

---

## Discipline — scope `discipline`

| Offence | Colour | Points | Fine | Straight ban |
|---|---|---|---|---|
| `dissent` | yellow | 1 | 1000p | — |
| `unsportingBehaviour` | yellow | 1 | 1000p | — |
| `persistentFouling` | yellow | 2 | 1500p | — |
| `denyingGoalscoringOpportunity` | red | 3 | 3500p | 1 |
| `seriousFoulPlay` | red | 4 | 5000p | 2 |
| `violentConduct` | red | 6 | 8000p | 3 |

Every time a running total crosses a threshold, the card that crossed it carries a ban:

| Total reaches | Matches |
|---|---|
| 5 | 1 |
| 10 | 2 |
| 15 | 3 |
| 20 | 4 |

The threshold has to be crossed, not merely met — sitting on 5 and going to 6 carries nothing. A
straight ban and an accumulated one are **served together**, so a card carrying both is worth the
longer of the two, not their sum.

### `POST /fixtures/:fixtureId/cards`
Takes `playerId`, `offence`, `shownOn`, which must be the day the game was played.

`201` gives `id`, `fixtureId`, `playerId`, `teamId`, `offence`, `colour`, `points`, `finePence`,
`straightBan`, `accumulationBan`, `runningPoints`, `status`, `shownOn`, `rescindedOn`, `createdAt`,
`updatedAt`. The colour and tariff come from the offence, not from the caller.

`409` when the player is at neither club in the game, has been released, has already been sent off
in it, or when the game was called off.

### `GET /fixtures/:fixtureId/cards` and `GET /cards`
Filters: `playerId`, `teamId`, `fixtureId`, `colour`, `status`. Oldest first.

### `GET /cards/:cardId`

### `POST /cards/:cardId/rescind`
Takes `rescindedOn`, not before the card was shown. Takes the card off the record **and reworks
every card that came after it**, because a threshold that was crossed may no longer be — a ban a
later card had already earned can disappear.

### `GET /players/:playerId/record?asOf=YYYY-MM-DD`
`asOf` is required. Answers `playerId`, `clubId`, `asOf`, `cards`, `yellows`, `reds`, `points`,
`finesPence`, `matchesBanned`, `standing`.

`standing` is `suspended` when anything is being served, `warned` from 3 points, else `clear`.
"Being served" is the serving ledger's answer below: a ban that the side's games have fully served no
longer suspends anybody, however many matches `matchesBanned` still adds up to.

---

## Suspensions — reads only

Neither reading is stored. Both are derived from the cards a player holds and the games their side
has played, so rescinding a card or settling a disputed score changes the answer the next time it is
asked for.

How serving works:

- A card is worth the longer of its straight and accumulated ban. A card worth nothing is not in the
  ledger at all.
- A ban is served over the games of the side the card was shown for (the card's `teamId`), one match
  per game. Only a game with status `played` serves anything: awarded, postponed and abandoned games
  serve nothing, even though an awarded game reaches the table.
- A straight ban can be served by any game after the card. An accumulated ban waits: no game before
  the fourteenth day after the card serves it, because a club has that long to claim the booking was
  wrongly recorded. A card carrying both is one ban, and one served match comes off both parts at
  once, so a red that also crossed a threshold serves its straight match straight away and then
  waits for the rest.
- Each played game serves one match off the earliest card it can serve, which is not always the
  earliest card outstanding: a ban still inside its wait lets a game go past it to a later straight
  one. The game a card was shown in never counts.
- A player is barred from a game when that game would serve them a match, read off everything up to
  the day before. Owing a match is not enough: a ban still inside its wait bars nobody yet, though
  the record already reads `suspended` for it. The bar covers every side of whichever club the
  player is at. A transfer moves the bar to the new club; the games serving the ban stay where they
  were.
- A rescinded card leaves the ledger, and the games it had used fall through to later cards.
- `asOf` cuts twice: cards shown after it are not in the reading, and games played after it have
  served nothing yet.

A worked example. A red for serious foul play on 6 September is worth two matches. The side's next
game, on 20 September, is postponed; the one on 4 October is awarded; the one on 18 October is
played. Read on 19 October, the entry says `matches` 2, `served` 1, `outstanding` 1, `servedIn` holds
the 18 October game alone, `clearedOn` is `null`, and the player is `suspended`. Eligibility for the
side's game on 1 November lists them with `outstanding` 1. Once 1 November has been played, the game
on 15 November lists nobody and `clearedOn` reads `2031-11-01`.

A second, on the wait. A fifth booking point on 20 September carries one accumulated match. The
side plays on 27 September and 3 October: neither serves it, the player may start both, and the
ledger meanwhile reads `outstanding` 1 and `suspended`. The game on 4 October, the fourteenth day,
serves it.

### `GET /players/:playerId/suspensions?asOf=YYYY-MM-DD`
`asOf` is required.

Answers `playerId`, `asOf`, `matchesBanned`, `matchesServed`, `matchesOutstanding`, `suspended`
(true while anything is outstanding) and `entries`, oldest card first. An entry carries `cardId`,
`fixtureId`, `teamId`, `shownOn`, `matches`, `served`, `outstanding`, `servedIn` (the ids of the
games that served it, in the order they did) and `clearedOn` (the day of the game that served the
last match, else `null`).

### `GET /fixtures/:fixtureId/eligibility`
Takes no query. Reads the day before the game, so the game itself cannot change who was allowed to
start it.

Answers `fixtureId`, `playedOn`, `asOf` (the day read) and `ineligible`: every registered player at
either club whom this game would serve a match, home side first and then by player id, each as
`playerId`, `clubId`, `teamId` (their club's side in this game) and `outstanding` (every match they
still owe, not only the one this game would serve).

---

## Audit — scope `staff`

A line per write, kept whether or not the write succeeded. The refused attempts are the ones worth
having.

**The request body is never stored — only its field names.** Sign-in bodies carry passwords, and a
trail that quietly keeps them is worse than no trail.

### `GET /audit`
Filters: `staffId`, `method`, `outcome`, `path` (a prefix, so `/clubs` brings back everything under
it). Newest first.

A line carries `id`, `staffId` (`null` when nobody was signed in), `method`, `path`, `status`,
`outcome`, `bodyKeys` (sorted), `happenedAt`. `outcome` is `accepted` under 400, `refused` from 400,
`failed` from 500.

Reads are not recorded. Only `POST`, `PATCH`, `PUT` and `DELETE`.

### `GET /audit/:entryId`

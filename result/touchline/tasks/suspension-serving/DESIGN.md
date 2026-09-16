# suspension-serving (provisional, pre Step 0)

Category: feature_request. Repo: touchline-league-api. Seat: dragan.

## The hole

Discipline prices a card and stops. `record()` totals `matchesBanned` and
nothing ever discharges it. Four exported helpers are never called anywhere:
`banFor` and `stands` (discipline.types), `counts` and `isOutstanding`
(fixture.types). `days.ts` says in its own header that "a suspension covers
whole fixtures", and `ineligiblePlayer` sits in `AWARD_REASONS` with no way to
know who was ineligible.

## Shape

New module `src/modules/suspensions/` on the house six layers, derived like
standings (no table of its own):

- `GET /players/:playerId/suspension?asOf=` — the ledger: every standing card
  that carried a ban, the games each was served over, what is outstanding, and
  the day the player is back.
- `GET /teams/:teamId/suspended?asOf=` — `{ items: [...] }`, who that side may
  not pick.
- `GET /fixtures/:fixtureId/eligibility` — who in either side may not play in
  that game.

Touches `src/app.ts` (wiring) and the discipline service (cards for a team).

## Rules where the difficulty lives

1. A ban is served over games of the team the card was shown for (`card.teamId`),
   never the player's current club, so a transfer discharges nothing.
2. Only a game that was **played** serves a match. Awarded, postponed and
   abandoned games serve nothing, though an awarded game does reach the table.
3. The game the card was shown in never counts: serving starts after `shownOn`.
4. A card's ban is the longer of straight and accumulated, not their sum.
5. Bans queue in card order (`shownOn`, then id). The next one starts only when
   the one before it is fully served.
6. `asOf` cuts twice: cards shown later are not in the reading, and games played
   later have served nothing.
7. A rescinded card leaves the ledger, and the games it had consumed fall
   through to the next ban.

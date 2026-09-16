`GET /players/:playerId/record` totals bans into `matchesBanned` and never works out which games were sat out, so `standing` reads `suspended` for good once banned. Make suspended mean a match still outstanding, and add two readings.

A card is worth the longer of its straight and accumulated ban; one worth nothing has no ledger entry. Bans are served over games of the side the card was shown for, one match per game, and only a game with status `played` serves anything: a walkover counts for the table yet serves nothing, and neither does a postponement or an abandonment. A straight ban can be served by any later game. An accumulated ban waits: no game before the fourteenth day after the card serves it. One game pays a match off both parts of a card at once. Each played game serves the earliest card it can serve. Rescinded cards drop out and games they used fall through to later cards. Readings take `asOf` like the table: cards shown later are out, games played later have served nothing.

`GET /players/:playerId/suspensions?asOf=` answers `playerId`, `asOf`, `matchesBanned`, `matchesServed`, `matchesOutstanding`, `suspended` and `entries`, oldest first, each with `cardId`, `fixtureId`, `teamId`, `shownOn`, `matches`, `served`, `outstanding`, `servedIn` (fixture ids, in order) and `clearedOn` (day its last match was served, else null).

`GET /fixtures/:fixtureId/eligibility` answers `fixtureId`, `playedOn`, `asOf` (the day before) and `ineligible`: every registered player at either club whom that game would serve a match, given everything up to the day before. A suspension bars a player from every side of their current club, whichever side serves it, so a transfer moves the bar and not the serving games. Listed home before away, then by player id, each as `playerId`, `clubId`, `teamId` (their side in this game) and `outstanding`.

Both routes need a bearer token, take no other query field, and treat days and unknown ids like other readings.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

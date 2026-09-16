`GET /players/:playerId/record` totals bans into `matchesBanned` and never works out which games were sat out, so `standing` reads `suspended` for good once banned. docs/api.md says suspended means still serving. Make that true and add two readings.

A card is worth the longer of its straight and accumulated ban; one worth nothing has no ledger entry. A ban is served over games of the side the card was shown for, and only a game with status `played` serves anything. A walkover counts for the table and still serves nothing, and neither does a postponement or an abandonment. Each played game serves one match off the earliest outstanding card shown to that side before it. While any match is outstanding the player is barred from every side of their current club, so a transfer moves the bar and not the serving games. Rescinded cards drop out and games they used fall through to later cards. Readings take `asOf` like the table: cards shown later are out, games played later have served nothing.

`GET /players/:playerId/suspensions?asOf=` answers `playerId`, `asOf`, `matchesBanned`, `matchesServed`, `matchesOutstanding`, `suspended` and `entries`, oldest first, each with `cardId`, `fixtureId`, `teamId`, `shownOn`, `matches`, `served`, `outstanding`, `servedIn` (fixture ids, in order) and `clearedOn` (day its last match was served, else null).

`GET /fixtures/:fixtureId/eligibility` reads the day before the game and answers `fixtureId`, `playedOn`, `asOf` and `ineligible`: every registered player at either club with a match outstanding that day, listed by side (home before away) and within a side by player id, each as `playerId`, `clubId`, `teamId` (their side in this game) and `outstanding`.

Record `standing` becomes `suspended` only while a match is outstanding as of `asOf`. Both routes need a bearer token, take no other query field, and treat days and unknown ids like other readings.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

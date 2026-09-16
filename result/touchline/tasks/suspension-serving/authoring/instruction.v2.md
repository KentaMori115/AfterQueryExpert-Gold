Discipline prices every card and stops there. `GET /players/:playerId/record` totals bans into `matchesBanned`, nothing works out which games a player then sat out, and `standing` reads `suspended` for good once anyone was banned. Our docs say suspended means something is still being served. Make that true, and add two readings that show the serving.

A card is worth the longer of its straight and accumulated ban. One worth nothing never appears in a ledger. A ban is served over games of the side the card was shown for (its `teamId`), one match per game, and only a game with status `played` serves anything. Awarded, postponed and abandoned games serve nothing, even though awarded ones reach the table. Each played game serves the earliest outstanding card shown to that side before that game. While any match is outstanding the player is barred from every side of whichever club they are at, so a transfer moves the bar but leaves the serving games where they were. Rescinded cards drop out and games they had used fall through to later cards. Readings take `asOf` like the table: cards shown later are not in it, games played later have served nothing.

`GET /players/:playerId/suspensions?asOf=` answers `playerId`, `asOf`, `matchesBanned`, `matchesServed`, `matchesOutstanding`, `suspended` and `entries`, oldest card first, each with `cardId`, `fixtureId`, `teamId`, `shownOn`, `matches`, `served`, `outstanding`, `servedIn` (fixture ids, serving order) and `clearedOn` (day of the game that served the last match, else null).

`GET /fixtures/:fixtureId/eligibility` reads the day before the game and answers `fixtureId`, `playedOn`, `asOf` and `ineligible`: every registered player at either club with a match outstanding that day, home side first then by player id, each as `playerId`, `clubId`, `teamId` (their club's side in this game) and `outstanding`.

`standing` in the record becomes `suspended` only while a match is outstanding as of `asOf`. Both routes sit behind a bearer token, take no other query field, and treat days and unknown ids like every other reading.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

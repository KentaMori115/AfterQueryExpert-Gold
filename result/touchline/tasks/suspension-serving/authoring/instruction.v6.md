`GET /players/:playerId/record` totals bans into `matchesBanned`, never works out which games were sat out, and leaves `standing` at `suspended` for good. Make it mean a match still owed, and add two readings.

A card is worth the longer of its straight and accumulated ban; one worth nothing has no ledger entry. Bans are served over games of the side the card was shown for, and only a game with status `played` serves: a walkover counts for the table yet serves nothing, nor does a postponement or abandonment. A straight ban starts with the next game; an accumulated ban waits, and no game before the fourteenth day after the card serves it. One game pays a match off both parts of a card. Each played game serves the earliest card it can serve. Rescinded cards drop out; their games fall through. With `asOf`, cards shown later are out and games played later have served nothing.

`GET /players/:playerId/suspensions?asOf=` answers `playerId`, `asOf`, `matchesBanned`, `matchesServed`, `matchesOutstanding`, `suspended` and `entries`, oldest first, each with `cardId`, `fixtureId`, `teamId`, `shownOn`, `matches`, `served`, `outstanding`, `servedIn` (fixture ids in order) and `clearedOn` (day of its last served match, else null).

`GET /fixtures/:fixtureId/eligibility` answers `fixtureId`, `playedOn`, `asOf` (the day before) and `ineligible`: every registered player at either club whom that game would serve a match, as of that day. A ban bars a player from every side of their current club, whichever side serves it: a transfer moves the bar, not the serving games. Home before away, then by player id, each as `playerId`, `clubId`, `teamId` (their side in this game) and `outstanding` (all still owed).

Both routes need a bearer token, take no other query field, and treat days and unknown ids like other readings.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

ArenaFlow can void a match down in `domain/matches/match.ts`, and nothing above that
layer ever calls it, so a result that should never have counted sits on the board
forever.

Give `TournamentService` a `voidMatch({ matchId, at, reason })`. Blank reason is an
invalid argument, a tournament that is not active an illegal state, a second withdrawal
a conflict, a match nobody created not found. The match takes voided status and the
withdrawal time, keeps what it recorded, and accepts no result after that. Standings
for that tournament are then decided again from results that survive, oldest first,
ties broken by match id. Nothing is subtracted. A bonus a later win only reached
through the withdrawn one stops being paid, and wins, losses, draws, streak, best
streak, reason trail and last update all follow surviving results. A player left with
nothing starts over, dated at the withdrawal. `MatchVoided` carries `matchId`,
`tournamentId`, `reason` and rebuilt `scores`, so replay reaches those same records.

`voidHistory(tournamentId)` and `voidsForPlayer(playerId)` answer oldest first. Each
entry holds `matchId`, `tournamentId`, `reason`, `at`, `previousStatus` and `changes`,
one change per player whose total moved, carrying `playerId`, `before`, `after`,
`delta`. `buildTournamentReport` takes those entries last and prints them under
`voids`.

`publishLeaderboard(tournamentId, at)` freezes a board. Rankings handed out afterwards
measure movement against the last published one, and before any publication a rank is
new. `publishedLeaderboard` finds nothing until then, `publicationHistory` keeps them
all.

Reach it through `POST /matches/:id/void`, `POST /leaderboards/:id/publish`,
`GET /leaderboards/:id/published`, `GET /tournaments/:id/voids`, through
`sdk.matches.voidMatch`, `sdk.rankings.publish`, `sdk.rankings.published`,
`sdk.tournaments.voids`, and through `match:void --id --reason --at`,
`leaderboard:publish`, `leaderboard:published` and `tournament:voids`, listed like
every other command. Catalog `match.voided`, `score.rebuilt` and `rank.published`.
Leave existing tests as they are.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

A result recorded wrong stands forever. Matches carry a voided status nothing
in `TournamentService` ever reaches, so scores keep points nobody earned.

Add `voidMatch({ matchId, reason, at })`. It withdraws a completed match of an
active tournament: status `voided`, stamped `at`, holding on to results it was
completed with. A match still running or already withdrawn, or a tournament
past active, is `IllegalStateError`. Blank reason is `InvalidArgumentError`,
unknown match a `NotFoundError`, and refusals write nothing.

Withdrawal is not subtraction. Every player holding a result there has their
score for that tournament rebuilt from tournament matches that still stand,
oldest settlement first and ties by match id, each result scored again through
that tournament's scoring config against the score built so far and stamped
with that match's `completedAt`. Totals, records, streak, best streak and
reasons behind them then describe what is left, and a streak bonus a withdrawn
win paid for is not paid again. A player with nothing left keeps a record
reading zero, stamped `at`. Players the match never touched are not rebuilt.

It answers with `match`, `tournamentId`, trimmed `reason`, `at`, and
`rebuilt`, those records in player id order.

`MatchVoided` lands on that match's own stream carrying the reason, and a
journal replayed later reaches scores the live run left behind.

`POST /matches/:id/void` takes `reason` and `at`, `match:void --id --reason
--at` runs on the CLI, `matches.voidMatch` on the SDK.
`buildTournamentReport` takes the tournament's matches fifth and counts them
in `withdrawn`.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

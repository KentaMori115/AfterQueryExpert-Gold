Bot1 sizes a combo order from each trader's own setting and sends it at any price. Nothing caps a day's spend.

Add `BotRiskLimit` to `BotList`, with a migration: `user_id`, `cap_type`, `daily_debit_cap`, `cap_percentage`, `max_lots_per_order`, `max_lots_per_day`, `enabled` (default true), `created_at`. No row, or `enabled` false, and nothing changes. Only combo orders are metered.

Debit is the re-quoted combo price times 100 times lots. A day's cap is `daily_debit_cap` under `Fixed`, and `cap_percentage` of Schwab account equity under `ByAccountBalance`.

`send_order` cuts lots to the smallest of: what the setting asked for, `max_lots_per_order`, lots free under `max_lots_per_day`, whole lots today's money buys. Below one lot nothing goes out: no order, `(None, None, 0, None)` back, one `UserMessage` for that trader with `risk budget` in it, their Bot1 switched off.

A placed order holds its debit and lots against its US/Eastern trading day. `cancel_order` hands both back, twice hands back once. Put `trading_day(moment=None)` in a new `Engine/risk.py`: US/Eastern date as `YYYY-MM-DD`, moment without a zone read as UTC. It dates every hold, and `committed_debit(user_id, day=None)` and `committed_lots(user_id, day=None)` beside it answer what one day holds, today by default.

Superusers, and nobody else, get `/admin/risk_budget/`, context carrying `risk_budget_records`: a row per user with `user_id`, `daily_debit_cap`, `committed_debit`, `remaining_debit`. The same two hands hold `/admin/risk_budget_change/`, which saves one trader's numbers from a POST, and `/admin/risk_budget_release/`, which frees a trader's day. Both answer 400 to a GET or an unknown trader; the first also to a negative number, an unreadable one, or an unknown cap type.

A day out of money, or out of lots, starts no bot: `/bot_onoff/` answers `fail` and changes nothing.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

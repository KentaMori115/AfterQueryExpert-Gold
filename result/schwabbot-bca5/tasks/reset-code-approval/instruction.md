Anybody who knows a username can walk `/accounts/forgot_password/` end to end: step one queues a request, an administrator switches it on, step two sets any password. `UserPwdRequest` has carried a `secret_code` and a `call_count` all along, the approval page prints both, nothing reads either.

Make the code count. Step two grows a required `secret_code` box, compared as text, and only a match reaches the password boxes. A wrong one costs a try whatever those boxes hold; a right one costs nothing. Spend the tries and the request goes back: approval off, count zero, `approved_at` cleared, `created_at` now, a six digit code that is not the one it replaces. A queued request is otherwise left untouched.

Tries depend on how often that request has been switched on, so count switch-ons too: three on a first approval, one on every later one. That count is the single thing going back leaves alone.

Codes die at market close. Add `approved_at`, filled by whichever step first finds `allowed_by_admin` set, since the approval page writes that flag through a queryset update and records nothing. `UserPwdRequest.code_deadline()` answers the first weekday 16:00 US/Eastern falling at least two hours after the approval, or after `created_at` while queued; a nearer bell is skipped along with the ones already gone. Either step meeting a request past its deadline sends it back, and so does one whose approval time stands beside a flag no longer set, which only a change of mind produces.

A password an account is using, or moved off in its last five, is refused, after the strength rules, on `/change_password/` too. Both pages remember what they replaced.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

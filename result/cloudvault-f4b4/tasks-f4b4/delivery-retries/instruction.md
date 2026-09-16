`dispatchWebhookEvent` posts each event once: a timeout loses it, a dead endpoint keeps getting hit.

Queue them in `lib/webhook-queue.ts`, two exports.

A queued delivery carries `id`, `endpointId`, `event`, `attempts`, `queuedAt`, `nextAttemptAt`, `status` (`pending`, `delivered`, `abandoned`), times in epoch milliseconds. Health carries `endpointId`, `consecutiveFailures`, `cooldownLevel`, `cooldownUntil`, `probeId`; not resting means `cooldownUntil` 0, and `probeId` is null while no probe is out.

`sweepQueue(queue, endpoints, health, now)` returns `{ send, abandoned, health }`; the first two hold delivery ids. Order pending deliveries by `nextAttemptAt`, ties by `id`. Abandon across the queue first, due or not: eight attempts used, a full day since `queuedAt`, endpoint missing or switched off, or an earlier-queued pending copy of that event for that endpoint, only the longest-waiting copy surviving. Survivors send once `nextAttemptAt` arrives. An endpoint with `cooldownUntil` past `now` sends nothing. One whose rest is over lets a single delivery through, first in order, as `probeId`, holding the others until what `probeId` names stops being pending, abandoned here included. The remainder goes out in turns, one per endpoint per round in the order endpoints first come up, three rounds and six ids at most. Return one health record per endpoint given, unknown from zero.

`recordAttempt(delivery, health, succeeded, now)` returns `{ delivery, health }` after one attempt, which always counts. Success delivers it and leaves the endpoint clean. Failure waits 30 seconds, doubling per attempt, capped at 30 minutes; give up at eight attempts or a day queued, `nextAttemptAt` left alone. Five failures running rest the endpoint 15 minutes, doubling per level to 4 hours, count cleared. A failed probe rests it again at once, one level deeper, slot back.

Neither function changes its arguments.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

Nightly work goes out in the wrong order: `createJobQueue` hands out whatever ranks best, so the statement build is leased while the pricing it needs is still running.

Teach the queue to hold work behind other work. `enqueue` takes `dependsOn`, job ids, with the bookkeeping in `lib/ops/jobs/fences.ts`. A fenced job is never handed to a worker, however well it ranks, and still counts against `size`. Ids must name jobs the queue has seen, finished or not; anything else is refused, nothing enqueued.

Only completing brings a fence down; a retry, an expired lease and a heartbeat leave it standing. A job whose last fence comes down becomes available at that instant and takes its place by the ranking already in use, so work waiting longer goes first.

A fence that can never come down takes the work behind it: dead-letter a job and everything behind it, near or far, goes too, `blocked by` and the id of the job that actually failed, written down after it one round at a time and inside a round in arrival order. A job enqueued behind one already dead goes the same way at once, and `enqueue` still answers with its id.

Add `fencePlan()`, which changes nothing but run-out leases, taken back as claiming does. `ready` names what a worker would be handed, in that order. `waiting` holds an entry per fenced job: `id`, the `blockedBy` ids still standing in the order given, and `wave`, one round behind work the queue holds and one more for every waiting job in front; order it by wave, then arrival. `dead` names each dead letter and its reason, in order.

Leave what the queue already does alone.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.

# Job Fences

How the background queue holds one job behind another, what brings a fence
down, and what happens to the work behind a job that never finishes.

---

## Why this exists

The nightly pipeline is not a list of independent jobs. It is a small graph:

```
collect-usage ──▶ price-cycle ──▶ build-statement ──▶ email-client
                       │
                       └────────▶ refresh-dashboard
```

Until now the queue had no idea about any of that. `createJobQueue` handed out
whatever ranked highest and trusted the worker pool to sort the rest out. In
practice that meant one of three bad mornings:

- `build-statement` was leased while `price-cycle` was still running, and the
  client woke up to a statement with yesterday's numbers on it.
- `price-cycle` failed for good at 03:12, and the three jobs behind it were
  claimed anyway, failed on missing rows, and each burned their own three
  attempts before landing in the dead-letter list with three different and
  equally unhelpful reasons.
- Someone added a `sleep`-and-retry loop to the worker to paper over the first
  two, which turned a 4 minute pipeline into a 40 minute one.

A **fence** is the queue's answer. A job can be enqueued behind other jobs, and
the queue simply does not offer it to a worker until they are done.

---

## The model

Three ideas, and nothing else:

1. **A fence is a job id.** A job is enqueued behind zero or more ids. Those
   ids have to be jobs the queue already knows about. There is no separate
   registry of graphs, stages or pipelines to keep in step.
2. **Only completing brings a fence down.** Not a retry, not an expired lease,
   not a heartbeat. A job that is still being worked on is still a fence.
3. **A fence that can never come down takes the work behind it with it.** A
   dead letter is final, so everything standing behind it is dead-lettered in
   the same breath rather than left parked forever.

Because a fence has to name a job the queue has already seen, fences cannot
loop. There is no cycle check to run and no cycle error to handle: the
ordering falls out of the order things were enqueued.

---

## Enqueueing behind other work

```ts
import { createFrozenClock } from '@/lib/ops/clock'
import { createJobQueue } from '@/lib/ops/jobs/queue'

const clock = createFrozenClock(Date.now())
const queue = createJobQueue(clock, {
  visibilityMs: 30_000,
  backoff: { baseMs: 1_000, factor: 2, maxMs: 60_000, jitterRatio: 0.2 },
})

queue.enqueue({ id: 'collect-usage', name: 'usage', payload: { cycle: '2026-03' } })

queue.enqueue({
  id: 'price-cycle',
  name: 'pricing',
  payload: { cycle: '2026-03' },
  dependsOn: ['collect-usage'],
})

queue.enqueue({
  id: 'build-statement',
  name: 'statement',
  payload: { cycle: '2026-03' },
  priority: 10,
  dependsOn: ['price-cycle'],
})
```

`claim()` will hand out `collect-usage` and then nothing at all, however hard
the pool asks, until that job is completed. `build-statement` has the best
priority in the queue and it makes no difference: rank decides between jobs
that *can* run, never whether a job can run.

A fenced job still counts against `size()`. It is work the queue is holding,
not work the queue has forgotten.

### Fences on jobs that are already finished

```ts
queue.enqueue({ id: 'seed', name: 'seed', payload: {} })
queue.claim()
queue.complete('seed')

queue.enqueue({ id: 'follow-up', name: 'follow', payload: {}, dependsOn: ['seed'] })
// ready at once: the fence was already down when the job arrived
```

The queue remembers how every job it has seen finished, so a fence on
completed work is satisfied immediately rather than refused. That keeps
enqueue code free of "has this run yet?" branches.

### Fences on jobs nobody has heard of

```ts
queue.enqueue({ id: 'orphan', name: 'orphan', payload: {}, dependsOn: ['typo'] })
// throws: Job orphan cannot wait on unknown job typo
```

This is the one refusal. A fence on an id the queue has never seen is almost
always a typo or a race in the enqueuing code, and parking the job forever
would hide it. The job is not enqueued at all — `size()` does not move.

---

## What happens when a fence comes down

Completing a job releases everything whose last fence it was. Two rules
decide what the released work does next, and both of them are the queue's
existing rules rather than new ones:

**It becomes available at the instant the fence came down.** Not at the
instant it was enqueued. A job that waited four hours behind a nightly build
has been available for zero seconds when the build finishes.

**It takes its place by the ranking the queue already uses.** That ranking
leans on `availableAt` first and `priority` only to break ties, so a released
job sits behind work that has been waiting longer, even when the released job
is the more urgent of the two:

```ts
queue.enqueue({ id: 'nightly', name: 'nightly', payload: {} })
queue.enqueue({ id: 'ordinary', name: 'ordinary', payload: {}, priority: 100 })
queue.enqueue({ id: 'urgent', name: 'urgent', payload: {}, priority: 1, dependsOn: ['nightly'] })

queue.claim()            // nightly
clock.advance(5 * 60_000)
queue.complete('nightly')

queue.claim()            // ordinary — waiting since the start of the run
queue.claim()            // urgent
```

This surprises people, and it is deliberate. The alternative — letting a
released job jump the whole queue on priority — starves the ordinary work
whenever a long pipeline finishes, which is exactly the failure the fences
were added to prevent. If a released job genuinely has to go first, give the
work in front of it a worse priority; do not reach into `availableAt`.

Jobs released together, on the other hand, are ranked against each other on
priority in the usual way, because they became available at the same instant.

---

## What happens when a fence never comes down

A job is dead-lettered when it fails on its last attempt. Everything standing
behind it, directly or several links back, is dead-lettered at the same time:

```ts
queue.enqueue({ id: 'price-cycle', name: 'pricing', payload: {}, maxAttempts: 3 })
queue.enqueue({ id: 'build-statement', name: 'statement', payload: {}, dependsOn: ['price-cycle'] })
queue.enqueue({ id: 'email-client', name: 'email', payload: {}, dependsOn: ['build-statement'] })

// ... three failed attempts later

queue.deadLetters()
// [
//   { job: price-cycle,     reason: 'row 4181 has no rate' },
//   { job: build-statement, reason: 'blocked by price-cycle' },
//   { job: email-client,    reason: 'blocked by price-cycle' },
// ]
```

Three things to notice:

- The reason on the cascaded jobs names **the job that actually failed**, not
  the job immediately in front. `email-client` did not fail because
  `build-statement` failed; both failed because pricing did. An on-call
  engineer reading the dead-letter list gets one cause, not a chain of
  hearsay.
- The failed job keeps its own reason. Nothing overwrites it.
- The cascade is written down after the job that failed, one round at a time,
  and inside a round in the order the jobs were enqueued. The list reads
  outward from the cause.

A job enqueued behind a job that is already dead goes the same way at once —
it is dead-lettered on arrival rather than queued and then swept up later.
`enqueue` still answers with the id, so callers that key off the answer do not
need a new branch.

### Retries are not failures

A job that fails with attempts to spare is not dead. It goes back into the
queue on the usual backoff, and everything behind it stays exactly where it
was: waiting, not dead. Only the last attempt breaks a fence.

---

## Reading the queue: `fencePlan()`

`fencePlan()` answers "what is this queue about to do?" without taking
anything out of it:

```ts
const plan = queue.fencePlan()

plan.ready
// ['collect-usage']

plan.waiting
// [
//   { id: 'price-cycle',     blockedBy: ['collect-usage'], wave: 1 },
//   { id: 'build-statement', blockedBy: ['price-cycle'],   wave: 2 },
//   { id: 'email-client',    blockedBy: ['build-statement'], wave: 3 },
// ]

plan.dead
// []
```

### `ready`

The jobs a worker would be handed, in the order it would get them. A job that
is out with a worker is not in `ready`; neither is a job that failed and is
waiting out its backoff.

Reading the plan takes back leases that have run out, exactly the way claiming
does. Without that, the plan would report a queue as idle while a crashed
worker's lease was still nominally live, which is the one moment an operator
is most likely to be looking at it. Nothing else about the queue changes: the
next `claim()` hands out the same job the plan named first.

### `waiting`

One entry per fenced job:

| field | meaning |
| --- | --- |
| `id` | the fenced job |
| `blockedBy` | the fences still standing, in the order they were given at enqueue |
| `wave` | how many rounds of waiting stand between this job and the queue |

`blockedBy` drops a fence as soon as it comes down, so a job waiting on three
jobs shows three ids, then two, then one. The order is the order the caller
listed them, not the order they will finish — the list is a record of what was
asked for.

`wave` is 1 for a job whose fences are all jobs the queue is holding right now,
and one more for every waiting job in front of it. A job waiting on two things
takes the deeper of the two. In the pipeline above, `price-cycle` is wave 1,
`build-statement` is wave 2 and `email-client` is wave 3, which is exactly the
number of rounds of work left before each one can start.

Entries come back ordered by wave, and inside a wave in the order the jobs were
enqueued. That makes the list read like a plan of the run rather than an
arbitrary dump of the map.

### `dead`

Every dead letter as `{ id, reason }`, in the order they were written down —
the same order and the same reasons as `deadLetters()`, without the job
records. It is the shape a dashboard wants.

---

## Operating notes

**Fencing a large fan-out.** Enqueue the children first, then the job that
depends on all of them, listing every child id. There is no batch primitive
and there does not need to be: the last child to complete releases the parent.

**Draining.** A queue with fenced work in it is not idle. Check `size()`, not
`claim() === null`, or a deploy script will happily stop the workers with half
a pipeline still parked.

**Dead-letter volume.** The cascade means one broken job can produce a burst of
dead letters. That is the point — the alternative is the same burst spread over
the next hour with worse reasons attached — but it is worth remembering when
sizing an alert threshold. Alert on the number of *distinct* reasons that are
not `blocked by …`, and the burst collapses back to one line.

**Replaying.** Re-enqueue the cause first, then the work behind it, in the
order the plan listed them. Because a fence on completed work is satisfied at
once, a partial replay does not need any special handling.

**Idempotent enqueues.** A reused idempotency key keeps the fences the job was
given the first time. The second call's `dependsOn` is ignored, exactly as its
payload and priority are.

---

## What did not change

Everything else about the queue is untouched, and the existing suites pin it:

- ranking by `availableAt` then `priority`, ties by arrival
- the visibility window, heartbeats, and lease recovery on claim
- exponential backoff with deterministic jitter and no wall-clock reads
- idempotent enqueue, duplicate id refusal, dead-lettering on the last attempt
- `size()`, `deadLetters()` handing back a copy, and the errors thrown for
  unknown ids

A job enqueued with no `dependsOn` behaves precisely as it did before this
document existed.

---

## A run from end to end

The March close, as the queue sees it. The clock starts at 03:00.

**03:00 — everything is enqueued at once.** The scheduler does not wait for one
job to finish before enqueuing the next; it lays the whole run down in one go
and lets the fences hold it in shape.

```ts
queue.enqueue({ id: 'collect-usage', name: 'usage', payload: cycle })
queue.enqueue({ id: 'price-cycle', name: 'pricing', payload: cycle, dependsOn: ['collect-usage'] })
queue.enqueue({ id: 'build-statement', name: 'statement', payload: cycle, dependsOn: ['price-cycle'] })
queue.enqueue({ id: 'refresh-dashboard', name: 'refresh', payload: cycle, dependsOn: ['price-cycle'] })
queue.enqueue({ id: 'email-client', name: 'email', payload: cycle, dependsOn: ['build-statement'] })
```

The plan at 03:00:

```
ready    collect-usage
waiting  price-cycle        blockedBy collect-usage      wave 1
         build-statement    blockedBy price-cycle        wave 2
         refresh-dashboard  blockedBy price-cycle        wave 2
         email-client       blockedBy build-statement    wave 3
size     5
```

Four of the five jobs are held. One worker asking for work gets
`collect-usage`; a second worker asking a millisecond later gets nothing, and
that is correct rather than a bug to be worked around.

**03:04 — usage lands.** `complete('collect-usage')` brings the only fence on
`price-cycle` down. It becomes available at 03:04 and joins the queue at that
instant. Nothing else moves: `build-statement` and `refresh-dashboard` are
still behind pricing, which is now running rather than finished.

**03:11 — pricing lands.** Two jobs come off the fence together. They became
available at the same instant, so priority decides between them, and the
statement build goes first because it was given the better one. The dashboard
refresh follows.

**03:12 — an ad-hoc export is enqueued.** Somebody in support kicks off a
one-off export with the default priority. It is available immediately, and
`refresh-dashboard` has been available since 03:11, so the refresh still goes
first. Work that has been waiting longer wins; the export does not jump it.

**03:19 — the statement build fails for the third time.** It is dead-lettered
with the reason the worker gave, and `email-client`, which has been waiting
since 03:00, is dead-lettered in the same breath as `blocked by
build-statement`. Nobody emails a client a statement that does not exist, and
nobody spends three more attempts discovering that.

The plan at 03:19:

```
ready    refresh-dashboard, ad-hoc-export
waiting  (none)
dead     build-statement    stripe: rate 4181 missing
         email-client       blocked by build-statement
```

**03:40 — the replay.** The rate is fixed and the two jobs are re-enqueued in
the order the plan listed them. `build-statement` is enqueued first with no
fence, `email-client` behind it. The rest of the run is already complete, so
nothing has to be repeated.

---

## How this is tested

The queue's own suite covers the parts that did not change: ranking,
visibility, heartbeats, backoff, idempotency and dead-lettering. The fence
behaviour is worth testing along four seams, and they are the seams that break
when someone refactors:

**Holding.** A fenced job is not claimable however it ranks, still counts
against `size()`, and a fence on an id nobody has seen is refused rather than
parked.

**Releasing.** Completing is the only thing that releases. Drive a retry, an
expired lease and a heartbeat past a fenced job and assert it is still waiting
after each one — those three are where a plausible implementation goes wrong,
because all three look like "the job in front moved" from the outside.

**Ranking after release.** Assert the released job lands behind work that has
been waiting longer, and that two jobs released together are ranked against
each other on priority. A test that only ever releases into an empty queue
will pass against an implementation that resets `availableAt` to zero.

**Cascading.** A chain of three, failed at the root, produces three dead
letters: the cause with its own reason and two `blocked by <root>` behind it,
in wave order. Assert the whole list, not its length — the order is the part
that carries the meaning.

Use `createFrozenClock` for all of it. Nothing in the queue reads the wall
clock, and a test that needs a real one has found a bug rather than a timing
problem.

---

## Where the code lives

| file | holds |
| --- | --- |
| `lib/ops/jobs/fences.ts` | the book of what waits on what, and nothing else |
| `lib/ops/jobs/queue.ts` | the queue, which asks the book and acts on the answer |
| `lib/ops/jobs/heap.ts` | ranking, unchanged |
| `lib/ops/jobs/backoff.ts` | retry delays, unchanged |

The book keeps no job records. It knows ids, the order they were given in, and
how each settled job finished; when an answer depends on what the queue is
still holding, the queue passes that in. That split is why the cascade and the
wave count can be read straight out of the book without walking the heap.

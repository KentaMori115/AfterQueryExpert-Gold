// Delivery queue for outgoing webhooks.
//
// Endpoints go down, time out, and come back. Posting an event once and
// logging whatever happened loses the event when that happens, and keeps
// hammering an endpoint that is already refusing traffic. So events are
// queued instead, and a sweep decides what may go out right now: which
// deliveries are due, which have run out of road, and which endpoints are
// being rested. The result of each attempt then feeds back into both
// schedules.

import type { WebhookEndpoint } from "./webhook"
import {
    FAILURE_THRESHOLD,
    MAX_ATTEMPTS,
    QUEUE_DEADLINE_MS,
    SWEEP_ENDPOINT_LIMIT,
    SWEEP_TOTAL_LIMIT,
    cooldownMs,
    retryDelayMs,
} from "./webhook-retry"

export type DeliveryStatus = "pending" | "delivered" | "abandoned"

export interface QueuedDelivery {
    id: string
    endpointId: string
    event: string
    attempts: number
    queuedAt: number
    nextAttemptAt: number
    status: DeliveryStatus
}

export interface EndpointHealth {
    endpointId: string
    consecutiveFailures: number
    cooldownLevel: number
    cooldownUntil: number
    probeId: string | null
}

export interface SweepPlan {
    send: string[]
    abandoned: string[]
    health: EndpointHealth[]
}

export interface AttemptRecord {
    delivery: QueuedDelivery
    health: EndpointHealth
}

export function freshHealth(endpointId: string): EndpointHealth {
    return {
        endpointId,
        consecutiveFailures: 0,
        cooldownLevel: 0,
        cooldownUntil: 0,
        probeId: null,
    }
}

function copyHealth(h: EndpointHealth): EndpointHealth {
    return {
        endpointId: h.endpointId,
        consecutiveFailures: h.consecutiveFailures,
        cooldownLevel: h.cooldownLevel,
        cooldownUntil: h.cooldownUntil,
        probeId: h.probeId === undefined ? null : h.probeId,
    }
}

// Deliveries go out oldest-due first; the id breaks ties so a sweep over the
// same queue always makes the same choice.
function byDueThenId(a: QueuedDelivery, b: QueuedDelivery): number {
    if (a.nextAttemptAt !== b.nextAttemptAt) return a.nextAttemptAt - b.nextAttemptAt
    if (a.id < b.id) return -1
    if (a.id > b.id) return 1
    return 0
}

function isPending(d: QueuedDelivery): boolean {
    return d.status === "pending"
}

// A delivery has run out of road once it has used up its attempts, once it
// has sat in the queue past the deadline, or once the endpoint it was queued
// for is gone or switched off.
function isSpent(
    d: QueuedDelivery,
    endpoint: WebhookEndpoint | undefined,
    now: number,
): boolean {
    if (!endpoint || endpoint.isActive === false) return true
    if (d.attempts >= MAX_ATTEMPTS) return true
    return now - d.queuedAt >= QUEUE_DEADLINE_MS
}

/**
 * Decide what this sweep may send.
 *
 * Abandonment is settled first, across the whole queue, because a delivery
 * that is already spent or superseded must not stand in the way of one that is
 * not: it can neither hold an endpoint's probe slot nor eat into the sweep.
 */
export function sweepQueue(
    queue: QueuedDelivery[],
    endpoints: WebhookEndpoint[],
    health: EndpointHealth[],
    now: number,
): SweepPlan {
    const byEndpoint = new Map<string, WebhookEndpoint>()
    for (const ep of endpoints || []) {
        if (ep && typeof ep.id === "string") byEndpoint.set(ep.id, ep)
    }

    const known = new Map<string, EndpointHealth>()
    for (const h of health || []) {
        if (h && typeof h.endpointId === "string") known.set(h.endpointId, copyHealth(h))
    }
    const healthOf = (endpointId: string): EndpointHealth => {
        let h = known.get(endpointId)
        if (!h) {
            h = freshHealth(endpointId)
            known.set(endpointId, h)
        }
        return h
    }

    const pending = (queue || []).filter(isPending).sort(byDueThenId)

    // Two pending deliveries of one event to one endpoint say the same thing
    // twice, so only the one that has been waiting longest survives. Queue
    // time decides that, which is not the order the sweep works in.
    const oldest = new Map<string, QueuedDelivery>()
    for (const d of pending) {
        const key = `${d.endpointId}\u0000${d.event}`
        const held = oldest.get(key)
        if (!held || d.queuedAt < held.queuedAt
            || (d.queuedAt === held.queuedAt && d.id < held.id)) {
            oldest.set(key, d)
        }
    }
    const superseded = (d: QueuedDelivery): boolean => {
        const held = oldest.get(`${d.endpointId}\u0000${d.event}`)
        return held !== undefined && held.id !== d.id
    }

    const abandoned: string[] = []
    const spent = new Set<string>()
    for (const d of pending) {
        if (superseded(d) || isSpent(d, byEndpoint.get(d.endpointId), now)) {
            abandoned.push(d.id)
            spent.add(d.id)
        }
    }

    // A probe slot is only taken while the delivery holding it is still live.
    // One that this sweep just abandoned releases the slot straight away.
    const liveProbe = new Set<string>()
    for (const d of pending) {
        if (!spent.has(d.id)) liveProbe.add(d.id)
    }

    // Group what is eligible by endpoint, keeping the order endpoints first
    // show up in. A probing endpoint is truncated to its single probe here,
    // so the rotation below does not have to know about cooldowns at all.
    const queues = new Map<string, QueuedDelivery[]>()
    for (const d of pending) {
        if (spent.has(d.id)) continue
        if (d.nextAttemptAt > now) continue

        const h = healthOf(d.endpointId)
        if (h.cooldownUntil > now) continue

        if (h.cooldownUntil !== 0) {
            if (h.probeId !== null && liveProbe.has(h.probeId)) continue
            if (queues.has(d.endpointId)) continue
            h.probeId = d.id
            queues.set(d.endpointId, [d])
            continue
        }

        const bucket = queues.get(d.endpointId)
        if (bucket) {
            if (bucket.length < SWEEP_ENDPOINT_LIMIT) bucket.push(d)
        } else {
            queues.set(d.endpointId, [d])
        }
    }

    // One per endpoint per round, so a busy endpoint cannot spend the sweep on
    // its own backlog while another waits.
    const send: string[] = []
    for (let round = 0; round < SWEEP_ENDPOINT_LIMIT; round += 1) {
        for (const bucket of queues.values()) {
            if (send.length >= SWEEP_TOTAL_LIMIT) break
            const d = bucket[round]
            if (d) send.push(d.id)
        }
        if (send.length >= SWEEP_TOTAL_LIMIT) break
    }

    const out: EndpointHealth[] = []
    for (const ep of endpoints || []) {
        if (!ep || typeof ep.id !== "string") continue
        out.push(healthOf(ep.id))
    }

    return { send, abandoned, health: out }
}

/**
 * Fold the result of one attempt back into the delivery and its endpoint.
 *
 * Success closes everything down: the delivery is done and the endpoint is
 * healthy again from scratch. Failure moves two schedules at once, and the
 * probe is the case where they meet — a failed probe means the endpoint is
 * still down, so it goes straight back to cooling one level deeper without
 * waiting for another five failures.
 */
export function recordAttempt(
    delivery: QueuedDelivery,
    health: EndpointHealth,
    succeeded: boolean,
    now: number,
): AttemptRecord {
    const h = copyHealth(health)
    const attempts = delivery.attempts + 1
    const wasProbe = h.probeId === delivery.id

    if (delivery.status !== "pending") {
        return { delivery: { ...delivery }, health: h }
    }

    if (succeeded) {
        return {
            delivery: { ...delivery, attempts, status: "delivered" },
            health: {
                endpointId: h.endpointId,
                consecutiveFailures: 0,
                cooldownLevel: 0,
                cooldownUntil: 0,
                probeId: null,
            },
        }
    }

    if (wasProbe) h.probeId = null

    const enterCooldown = () => {
        h.cooldownLevel = h.cooldownLevel + 1
        h.cooldownUntil = now + cooldownMs(h.cooldownLevel)
        h.consecutiveFailures = 0
    }

    if (wasProbe) {
        enterCooldown()
    } else {
        const failures = h.consecutiveFailures + 1
        if (failures >= FAILURE_THRESHOLD) {
            enterCooldown()
        } else {
            h.consecutiveFailures = failures
        }
    }

    const done = attempts >= MAX_ATTEMPTS || now - delivery.queuedAt >= QUEUE_DEADLINE_MS
    const next: QueuedDelivery = done
        ? { ...delivery, attempts, status: "abandoned" }
        : {
              ...delivery,
              attempts,
              status: "pending",
              nextAttemptAt: now + retryDelayMs(attempts),
          }

    return { delivery: next, health: h }
}

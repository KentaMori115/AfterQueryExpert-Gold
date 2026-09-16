// Timing arithmetic for the webhook delivery queue.
//
// Two independent schedules live here. The per-delivery retry schedule spaces
// out attempts against one delivery; the per-endpoint cooldown schedule backs
// off from an endpoint that keeps refusing traffic. They are kept apart on
// purpose: a delivery that is ready to go again still waits while its endpoint
// is cooling, and the queue sweep is what reconciles the two.

// Retry: 30 s after the first failed attempt, doubling, never above 30 min.
export const RETRY_BASE_SECONDS = 30
export const RETRY_CAP_SECONDS = 1800

// A delivery is given up on after this many attempts, or once it has sat in
// the queue this long, whichever lands first.
export const MAX_ATTEMPTS = 8
export const QUEUE_DEADLINE_SECONDS = 86400

// Cooldown: 15 min for a first cooldown, doubling for each repeat, capped at
// 4 h. Five consecutive failures against one endpoint start the first one.
export const FAILURE_THRESHOLD = 5
export const COOLDOWN_BASE_SECONDS = 900
export const COOLDOWN_CAP_SECONDS = 14400

// How many of one endpoint's deliveries a single sweep is willing to send,
// and how many it will send in total. The pair is what makes a sweep fair:
// endpoints take turns, and one busy endpoint cannot spend the whole sweep.
export const SWEEP_ENDPOINT_LIMIT = 3
export const SWEEP_TOTAL_LIMIT = 6

function step(base: number, cap: number, exponent: number): number {
    if (!Number.isFinite(exponent) || exponent <= 1) return base
    const raw = base * Math.pow(2, Math.floor(exponent) - 1)
    return raw > cap ? cap : raw
}

// Seconds to wait before the next attempt, given how many attempts have
// already failed. Doubles per attempt from 30 s, held at 30 min.
export function retryDelaySeconds(attempts: number): number {
    return step(RETRY_BASE_SECONDS, RETRY_CAP_SECONDS, Number(attempts))
}

// Seconds an endpoint stays cool at this cooldown level. Level 1 is the first
// cooldown an endpoint enters, level 2 the one after that, and so on.
export function cooldownSeconds(level: number): number {
    return step(COOLDOWN_BASE_SECONDS, COOLDOWN_CAP_SECONDS, Number(level))
}

// Milliseconds are what the queue records carry, so convert once here rather
// than sprinkling the factor through the sweep.
export function retryDelayMs(attempts: number): number {
    return retryDelaySeconds(attempts) * 1000
}

export function cooldownMs(level: number): number {
    return cooldownSeconds(level) * 1000
}

export const QUEUE_DEADLINE_MS = QUEUE_DEADLINE_SECONDS * 1000

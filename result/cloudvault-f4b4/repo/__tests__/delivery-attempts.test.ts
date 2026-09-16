import { recordAttempt } from "../lib/webhook-queue"

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const NOW = 1_700_000_000_000

function delivery(over: Record<string, unknown> = {}): any {
    return {
        id: "d1",
        endpointId: "ep-1",
        event: "file.uploaded",
        attempts: 0,
        queuedAt: NOW - MINUTE,
        nextAttemptAt: NOW - SECOND,
        status: "pending",
        ...over,
    }
}

function health(over: Record<string, unknown> = {}): any {
    return {
        endpointId: "ep-1",
        consecutiveFailures: 0,
        cooldownLevel: 0,
        cooldownUntil: 0,
        probeId: null,
        ...over,
    }
}

describe("recordAttempt on success", () => {
    it("marks the delivery delivered", () => {
        const out = recordAttempt(delivery(), health(), true, NOW)

        expect(out.delivery.status).toBe("delivered")
    })

    it("counts the successful attempt", () => {
        const out = recordAttempt(delivery({ attempts: 2 }), health(), true, NOW)

        expect(out.delivery.attempts).toBe(3)
    })

    it("clears a run of failures", () => {
        const out = recordAttempt(delivery(), health({ consecutiveFailures: 4 }), true, NOW)

        expect(out.health.consecutiveFailures).toBe(0)
    })

    it("brings an endpoint out of its cooldown", () => {
        const out = recordAttempt(
            delivery(),
            health({ cooldownLevel: 3, cooldownUntil: NOW + HOUR, probeId: "d1" }),
            true,
            NOW,
        )

        expect(out.health.cooldownUntil).toBe(0)
        expect(out.health.probeId).toBeNull()
    })

    it("forgets how deep the cooldown had gone", () => {
        const out = recordAttempt(
            delivery(),
            health({ cooldownLevel: 4, cooldownUntil: NOW - SECOND, probeId: "d1" }),
            true,
            NOW,
        )

        expect(out.health.cooldownLevel).toBe(0)
    })
})

describe("recordAttempt retry schedule", () => {
    it("counts the failed attempt", () => {
        const out = recordAttempt(delivery(), health(), false, NOW)

        expect(out.delivery.attempts).toBe(1)
        expect(out.delivery.status).toBe("pending")
    })

    it("waits thirty seconds after the first failure", () => {
        const out = recordAttempt(delivery(), health(), false, NOW)

        expect(out.delivery.nextAttemptAt).toBe(NOW + 30 * SECOND)
    })

    it("doubles the wait after the second failure", () => {
        const out = recordAttempt(delivery({ attempts: 1 }), health(), false, NOW)

        expect(out.delivery.nextAttemptAt).toBe(NOW + 60 * SECOND)
    })

    it("keeps doubling through the third and fourth failures", () => {
        const third = recordAttempt(delivery({ attempts: 2 }), health(), false, NOW)
        const fourth = recordAttempt(delivery({ attempts: 3 }), health(), false, NOW)

        expect(third.delivery.nextAttemptAt).toBe(NOW + 120 * SECOND)
        expect(fourth.delivery.nextAttemptAt).toBe(NOW + 240 * SECOND)
    })

    it("reaches sixteen minutes on the sixth failure", () => {
        const out = recordAttempt(delivery({ attempts: 5 }), health(), false, NOW)

        expect(out.delivery.nextAttemptAt).toBe(NOW + 960 * SECOND)
    })

    it("holds the wait at half an hour", () => {
        const out = recordAttempt(delivery({ attempts: 6 }), health(), false, NOW)

        expect(out.delivery.nextAttemptAt).toBe(NOW + 30 * MINUTE)
    })
})

describe("recordAttempt giving up", () => {
    it("gives up once the eighth attempt has failed", () => {
        const out = recordAttempt(delivery({ attempts: 7 }), health(), false, NOW)

        expect(out.delivery.attempts).toBe(8)
        expect(out.delivery.status).toBe("abandoned")
    })

    it("gives up on a delivery that has now been queued for a day", () => {
        const out = recordAttempt(delivery({ queuedAt: NOW - DAY }), health(), false, NOW)

        expect(out.delivery.status).toBe("abandoned")
    })

    it("keeps retrying a delivery still inside the day", () => {
        const out = recordAttempt(
            delivery({ queuedAt: NOW - DAY + MINUTE }),
            health(),
            false,
            NOW,
        )

        expect(out.delivery.status).toBe("pending")
    })

    it("leaves the next attempt time alone once it gives up", () => {
        const original = delivery({ attempts: 7, nextAttemptAt: NOW - HOUR })
        const out = recordAttempt(original, health(), false, NOW)

        expect(out.delivery.nextAttemptAt).toBe(NOW - HOUR)
    })

    it("still records the failure against the endpoint", () => {
        const out = recordAttempt(
            delivery({ attempts: 7 }),
            health({ consecutiveFailures: 1 }),
            false,
            NOW,
        )

        expect(out.health.consecutiveFailures).toBe(2)
    })
})

describe("recordAttempt cooldown schedule", () => {
    it("counts a failure against the endpoint", () => {
        const out = recordAttempt(delivery(), health({ consecutiveFailures: 2 }), false, NOW)

        expect(out.health.consecutiveFailures).toBe(3)
        expect(out.health.cooldownUntil).toBe(0)
    })

    it("rests the endpoint on the fifth failure in a row", () => {
        const out = recordAttempt(delivery(), health({ consecutiveFailures: 4 }), false, NOW)

        expect(out.health.cooldownLevel).toBe(1)
        expect(out.health.cooldownUntil).toBe(NOW + 15 * MINUTE)
    })

    it("clears the failure count when the rest starts", () => {
        const out = recordAttempt(delivery(), health({ consecutiveFailures: 4 }), false, NOW)

        expect(out.health.consecutiveFailures).toBe(0)
    })

    it("doubles the rest each time an endpoint goes back into one", () => {
        const second = recordAttempt(
            delivery(),
            health({ consecutiveFailures: 4, cooldownLevel: 1 }),
            false,
            NOW,
        )
        const third = recordAttempt(
            delivery(),
            health({ consecutiveFailures: 4, cooldownLevel: 2 }),
            false,
            NOW,
        )

        expect(second.health.cooldownUntil).toBe(NOW + 30 * MINUTE)
        expect(third.health.cooldownUntil).toBe(NOW + 60 * MINUTE)
    })

    it("holds the rest at four hours", () => {
        const out = recordAttempt(
            delivery(),
            health({ consecutiveFailures: 4, cooldownLevel: 6 }),
            false,
            NOW,
        )

        expect(out.health.cooldownLevel).toBe(7)
        expect(out.health.cooldownUntil).toBe(NOW + 4 * HOUR)
    })
})

describe("recordAttempt probes", () => {
    it("rests the endpoint again as soon as a probe fails", () => {
        const out = recordAttempt(
            delivery(),
            health({ cooldownLevel: 1, cooldownUntil: NOW - SECOND, probeId: "d1" }),
            false,
            NOW,
        )

        expect(out.health.cooldownLevel).toBe(2)
        expect(out.health.cooldownUntil).toBe(NOW + 30 * MINUTE)
    })

    it("does not wait for another run of five when a probe fails", () => {
        const out = recordAttempt(
            delivery(),
            health({ consecutiveFailures: 0, cooldownLevel: 2, cooldownUntil: NOW, probeId: "d1" }),
            false,
            NOW,
        )

        expect(out.health.cooldownLevel).toBe(3)
        expect(out.health.consecutiveFailures).toBe(0)
    })

    it("hands the probe slot back after a failed probe", () => {
        const out = recordAttempt(
            delivery(),
            health({ cooldownLevel: 1, cooldownUntil: NOW - SECOND, probeId: "d1" }),
            false,
            NOW,
        )

        expect(out.health.probeId).toBeNull()
    })

    it("still schedules the failed probe for another go", () => {
        const out = recordAttempt(
            delivery({ attempts: 2 }),
            health({ cooldownLevel: 1, cooldownUntil: NOW - SECOND, probeId: "d1" }),
            false,
            NOW,
        )

        expect(out.delivery.status).toBe("pending")
        expect(out.delivery.nextAttemptAt).toBe(NOW + 120 * SECOND)
    })

    it("treats a failure by another delivery as an ordinary one", () => {
        const out = recordAttempt(
            delivery({ id: "d2" }),
            health({ consecutiveFailures: 1, cooldownLevel: 1, cooldownUntil: NOW - SECOND, probeId: "d1" }),
            false,
            NOW,
        )

        expect(out.health.cooldownLevel).toBe(1)
        expect(out.health.consecutiveFailures).toBe(2)
        expect(out.health.probeId).toBe("d1")
    })
})

describe("recordAttempt argument handling", () => {
    it("leaves the delivery it was handed unchanged", () => {
        const original = delivery({ attempts: 1 })
        const before = JSON.stringify(original)

        recordAttempt(original, health(), false, NOW)

        expect(JSON.stringify(original)).toBe(before)
    })

    it("leaves the health record it was handed unchanged", () => {
        const original = health({ consecutiveFailures: 4 })
        const before = JSON.stringify(original)

        recordAttempt(delivery(), original, false, NOW)

        expect(JSON.stringify(original)).toBe(before)
    })

    it("keeps the endpoint the record belongs to", () => {
        const out = recordAttempt(delivery(), health({ endpointId: "ep-7" }), false, NOW)

        expect(out.health.endpointId).toBe("ep-7")
    })
})

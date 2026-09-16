import crypto from "crypto"
import { getFirestore, FieldValue } from "firebase-admin/firestore"
import {
    type EndpointHealth,
    type QueuedDelivery,
    freshHealth,
    recordAttempt,
    sweepQueue,
} from "./webhook-queue"

function getAdminDb() {
    return getFirestore()
}

export interface WebhookEndpoint {
    id: string
    userId: string
    url: string
    secret: string
    events: string[] // e.g. ["file.uploaded", "file.deleted", "share.created", "rate_limit.exceeded"]
    description?: string
    isActive: boolean
    createdAt: Date
    updatedAt: Date
}

export interface WebhookDelivery {
    id: string
    endpointId: string
    userId: string
    event: string
    payload: any
    statusCode?: number
    responseBody?: string
    error?: string
    durationMs: number
    success: boolean
    timestamp: Date
}

/**
 * Generates an HMAC-SHA256 signature for a webhook payload.
 */
export function generateWebhookSignature(payload: string, secret: string): string {
    return crypto.createHmac("sha256", secret).update(payload).digest("hex")
}

/**
 * Registers a new webhook endpoint for a user.
 */
export async function createWebhookEndpoint(
    userId: string,
    url: string,
    events: string[],
    description = ""
): Promise<WebhookEndpoint> {
    const secret = "whsec_" + crypto.randomBytes(24).toString("hex")
    const data = {
        userId,
        url,
        secret,
        events: events.length > 0 ? events : ["*"],
        description,
        isActive: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    }

    const docRef = await getAdminDb().collection("webhooks").add(data)

    return {
        id: docRef.id,
        userId,
        url,
        secret,
        events: data.events,
        description,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
    }
}

/**
 * Retrieves all registered webhook endpoints for a user.
 */
export async function getUserWebhookEndpoints(userId: string): Promise<WebhookEndpoint[]> {
    try {
        const snap = await getAdminDb()
            .collection("webhooks")
            .where("userId", "==", userId)
            .get()

        return snap.docs.map((doc) => {
            const d = doc.data() as any
            return {
                id: doc.id,
                userId: d.userId,
                url: d.url,
                secret: d.secret,
                events: d.events || ["*"],
                description: d.description || "",
                isActive: d.isActive ?? true,
                createdAt: d.createdAt?.toDate?.() || new Date(),
                updatedAt: d.updatedAt?.toDate?.() || new Date(),
            }
        })
    } catch (err) {
        console.error("Failed to list webhook endpoints:", err)
        return []
    }
}

/**
 * Deletes a webhook endpoint.
 */
export async function deleteWebhookEndpoint(userId: string, endpointId: string): Promise<boolean> {
    try {
        const docRef = getAdminDb().collection("webhooks").doc(endpointId)
        const snap = await docRef.get()
        if (snap.exists && snap.data()?.userId === userId) {
            await docRef.delete()
            return true
        }
        return false
    } catch (err) {
        console.error("Failed to delete webhook endpoint:", err)
        return false
    }
}

/**
 * Dispatches an event payload to all active webhook endpoints matching the event type.
 */
export async function dispatchWebhookEvent(
    userId: string,
    event: string,
    payload: any
): Promise<WebhookDelivery[]> {
    const results: WebhookDelivery[] = []
    try {
        const endpoints = await getUserWebhookEndpoints(userId)
        const matching = endpoints.filter(
            (ep) => ep.isActive && (ep.events.includes("*") || ep.events.includes(event))
        )

        const health = await getEndpointHealth(userId)
        const now = Date.now()

        for (const ep of matching) {
            // An endpoint that is resting keeps its traffic in the queue; the
            // sweep releases it once the cooldown lapses.
            const resting = health.find((h) => h.endpointId === ep.id)
            if (resting && resting.cooldownUntil > now) continue

            const delivery = await sendWebhookDelivery(ep, event, payload)
            results.push(delivery)
        }
    } catch (err) {
        console.error("Error dispatching webhook event:", err)
    }
    return results
}

const QUEUE_COLLECTION = "webhook_queue"
const HEALTH_COLLECTION = "webhook_health"

/**
 * Queues one event for every endpoint of this user that subscribes to it.
 * Nothing is sent here: the sweep decides when each queued delivery goes out.
 */
export async function queueWebhookEvent(
    userId: string,
    event: string,
    payload: any
): Promise<QueuedDelivery[]> {
    const queued: QueuedDelivery[] = []
    try {
        const endpoints = await getUserWebhookEndpoints(userId)
        const matching = endpoints.filter(
            (ep) => ep.isActive && (ep.events.includes("*") || ep.events.includes(event))
        )

        const now = Date.now()
        for (const ep of matching) {
            const docRef = await getAdminDb().collection(QUEUE_COLLECTION).add({
                userId,
                endpointId: ep.id,
                event,
                payload,
                attempts: 0,
                queuedAt: now,
                nextAttemptAt: now,
                status: "pending",
            })

            queued.push({
                id: docRef.id,
                endpointId: ep.id,
                event,
                attempts: 0,
                queuedAt: now,
                nextAttemptAt: now,
                status: "pending",
            })
        }
    } catch (err) {
        console.error("Failed to queue webhook event:", err)
    }
    return queued
}

/**
 * Reads back the queue rows for a user, newest deadline last.
 */
export async function getWebhookQueue(userId: string): Promise<QueuedDelivery[]> {
    try {
        const snap = await getAdminDb()
            .collection(QUEUE_COLLECTION)
            .where("userId", "==", userId)
            .get()

        return snap.docs.map((doc) => {
            const d = doc.data() as any
            return {
                id: doc.id,
                endpointId: d.endpointId || "",
                event: d.event || "",
                attempts: d.attempts || 0,
                queuedAt: d.queuedAt || 0,
                nextAttemptAt: d.nextAttemptAt || 0,
                status: d.status || "pending",
            }
        })
    } catch (err) {
        console.error("Failed to read the webhook queue:", err)
        return []
    }
}

/**
 * Reads the per-endpoint health records backing the cooldown schedule.
 */
export async function getEndpointHealth(userId: string): Promise<EndpointHealth[]> {
    try {
        const snap = await getAdminDb()
            .collection(HEALTH_COLLECTION)
            .where("userId", "==", userId)
            .get()

        return snap.docs.map((doc) => {
            const d = doc.data() as any
            return {
                endpointId: d.endpointId || doc.id,
                consecutiveFailures: d.consecutiveFailures || 0,
                cooldownLevel: d.cooldownLevel || 0,
                cooldownUntil: d.cooldownUntil || 0,
                probeId: d.probeId || null,
            }
        })
    } catch (err) {
        console.error("Failed to read webhook endpoint health:", err)
        return []
    }
}

async function persistDelivery(delivery: QueuedDelivery): Promise<void> {
    try {
        await getAdminDb().collection(QUEUE_COLLECTION).doc(delivery.id).update({
            attempts: delivery.attempts,
            nextAttemptAt: delivery.nextAttemptAt,
            status: delivery.status,
        })
    } catch (err) {
        console.error("Failed to persist a queued delivery:", err)
    }
}

async function persistHealth(userId: string, health: EndpointHealth): Promise<void> {
    try {
        await getAdminDb()
            .collection(HEALTH_COLLECTION)
            .doc(`${userId}_${health.endpointId}`)
            .set({ userId, ...health }, { merge: true })
    } catch (err) {
        console.error("Failed to persist webhook endpoint health:", err)
    }
}

export interface SweepSummary {
    sent: number
    delivered: number
    abandoned: number
}

/**
 * Runs one sweep of the queue: abandons what is spent, sends what the plan
 * allows, and folds every result back into the two schedules.
 */
export async function drainWebhookQueue(
    userId: string,
    now: number = Date.now()
): Promise<SweepSummary> {
    const summary: SweepSummary = { sent: 0, delivered: 0, abandoned: 0 }
    try {
        const [queue, endpoints, health] = await Promise.all([
            getWebhookQueue(userId),
            getUserWebhookEndpoints(userId),
            getEndpointHealth(userId),
        ])

        const plan = sweepQueue(queue, endpoints, health, now)
        const byId = new Map(queue.map((d) => [d.id, d]))
        const healthById = new Map(plan.health.map((h) => [h.endpointId, h]))

        for (const id of plan.abandoned) {
            const delivery = byId.get(id)
            if (!delivery) continue
            await persistDelivery({ ...delivery, status: "abandoned" })
            summary.abandoned += 1
        }

        for (const id of plan.send) {
            const delivery = byId.get(id)
            if (!delivery) continue
            const endpoint = endpoints.find((ep) => ep.id === delivery.endpointId)
            if (!endpoint) continue

            const attempt = await sendWebhookDelivery(endpoint, delivery.event, {})
            const before = healthById.get(delivery.endpointId) || freshHealth(delivery.endpointId)
            const after = recordAttempt(delivery, before, attempt.success, Date.now())

            healthById.set(delivery.endpointId, after.health)
            await persistDelivery(after.delivery)
            await persistHealth(userId, after.health)

            summary.sent += 1
            if (after.delivery.status === "delivered") summary.delivered += 1
            if (after.delivery.status === "abandoned") summary.abandoned += 1
        }

        for (const h of plan.health) {
            await persistHealth(userId, healthById.get(h.endpointId) || h)
        }
    } catch (err) {
        console.error("Failed to drain the webhook queue:", err)
    }
    return summary
}

/**
 * Clears an endpoint's cooldown so the next sweep treats it as healthy again.
 */
export async function resumeWebhookEndpoint(
    userId: string,
    endpointId: string
): Promise<boolean> {
    try {
        const endpoints = await getUserWebhookEndpoints(userId)
        if (!endpoints.some((ep) => ep.id === endpointId)) return false
        await persistHealth(userId, freshHealth(endpointId))
        return true
    } catch (err) {
        console.error("Failed to resume a webhook endpoint:", err)
        return false
    }
}

/**
 * Sends an HTTP POST request to a single webhook endpoint and logs the delivery attempt.
 */
export async function sendWebhookDelivery(
    endpoint: WebhookEndpoint,
    event: string,
    payload: any
): Promise<WebhookDelivery> {
    const startTime = Date.now()
    const payloadStr = JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        data: payload,
    })

    const signature = generateWebhookSignature(payloadStr, endpoint.secret)

    let statusCode = 0
    let responseBody = ""
    let error: string | undefined
    let success = false

    try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000)

        const res = await fetch(endpoint.url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CloudVault-Signature": signature,
                "X-CloudVault-Event": event,
                "User-Agent": "CloudVault-Webhook-Engine/1.0",
            },
            body: payloadStr,
            signal: controller.signal,
        })

        clearTimeout(timeoutId)
        statusCode = res.status
        responseBody = (await res.text()).slice(0, 1000) // truncate body
        success = res.ok
    } catch (err: any) {
        error = err.message || "Failed to reach endpoint"
    }

    const durationMs = Date.now() - startTime

    const deliveryData = {
        endpointId: endpoint.id,
        userId: endpoint.userId,
        event,
        payload,
        statusCode,
        responseBody,
        error,
        durationMs,
        success,
        timestamp: FieldValue.serverTimestamp(),
    }

    try {
        const docRef = await getAdminDb().collection("webhook_deliveries").add(deliveryData)
        return {
            id: docRef.id,
            endpointId: endpoint.id,
            userId: endpoint.userId,
            event,
            payload,
            statusCode,
            responseBody,
            error,
            durationMs,
            success,
            timestamp: new Date(),
        }
    } catch (dbErr) {
        console.error("Failed to record webhook delivery log:", dbErr)
        return {
            id: "temp_" + Date.now(),
            endpointId: endpoint.id,
            userId: endpoint.userId,
            event,
            payload,
            statusCode,
            responseBody,
            error,
            durationMs,
            success,
            timestamp: new Date(),
        }
    }
}

/**
 * Retrieves delivery logs for a user.
 */
export async function getWebhookDeliveries(
    userId: string,
    limit = 50
): Promise<WebhookDelivery[]> {
    try {
        const snap = await getAdminDb()
            .collection("webhook_deliveries")
            .where("userId", "==", userId)
            .get()

        const deliveries = snap.docs.map((doc) => {
            const d = doc.data() as any
            return {
                id: doc.id,
                endpointId: d.endpointId || "",
                userId: d.userId,
                event: d.event || "",
                payload: d.payload || {},
                statusCode: d.statusCode || 0,
                responseBody: d.responseBody || "",
                error: d.error || undefined,
                durationMs: d.durationMs || 0,
                success: d.success ?? false,
                timestamp: d.timestamp?.toDate?.() || new Date(),
            }
        })

        deliveries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        return deliveries.slice(0, limit)
    } catch (err) {
        console.error("Failed to fetch webhook deliveries:", err)
        return []
    }
}

import { NextRequest, NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth-middleware"
import {
    drainWebhookQueue,
    getEndpointHealth,
    getUserWebhookEndpoints,
    getWebhookQueue,
} from "@/lib/webhook"
import { sweepQueue } from "@/lib/webhook-queue"

export async function GET(req: NextRequest) {
    const auth = await authenticateRequest(req)
    if (!auth.authenticated || !auth.userId) {
        return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 })
    }

    try {
        const [queue, endpoints, health] = await Promise.all([
            getWebhookQueue(auth.userId),
            getUserWebhookEndpoints(auth.userId),
            getEndpointHealth(auth.userId),
        ])

        const plan = sweepQueue(queue, endpoints, health, Date.now())
        return NextResponse.json({
            queue,
            health: plan.health,
            due: plan.send,
            spent: plan.abandoned,
        })
    } catch (err: any) {
        return NextResponse.json(
            { error: err.message || "Failed to read the webhook queue" },
            { status: 500 }
        )
    }
}

export async function POST(req: NextRequest) {
    const auth = await authenticateRequest(req)
    if (!auth.authenticated || !auth.userId) {
        return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 })
    }

    try {
        const summary = await drainWebhookQueue(auth.userId)
        return NextResponse.json({ summary })
    } catch (err: any) {
        return NextResponse.json(
            { error: err.message || "Failed to drain the webhook queue" },
            { status: 500 }
        )
    }
}

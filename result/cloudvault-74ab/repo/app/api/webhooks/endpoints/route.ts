import { NextRequest, NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth-middleware"
import { createWebhookEndpoint, getUserWebhookEndpoints } from "@/lib/webhook"

export async function GET(req: NextRequest) {
    const auth = await authenticateRequest(req)
    if (!auth.authenticated || !auth.userId) {
        return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 })
    }

    try {
        const endpoints = await getUserWebhookEndpoints(auth.userId)
        return NextResponse.json({ endpoints })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to fetch webhook endpoints" }, { status: 500 })
    }
}

export async function POST(req: NextRequest) {
    const auth = await authenticateRequest(req)
    if (!auth.authenticated || !auth.userId) {
        return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 })
    }

    try {
        const body = await req.json()
        const { url, events, description } = body

        if (!url || typeof url !== "string" || !url.startsWith("http")) {
            return NextResponse.json({ error: "A valid HTTP/HTTPS URL is required" }, { status: 400 })
        }

        const endpoint = await createWebhookEndpoint(auth.userId, url, Array.isArray(events) ? events : ["*"], description || "")
        return NextResponse.json({ endpoint }, { status: 201 })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to create webhook endpoint" }, { status: 500 })
    }
}

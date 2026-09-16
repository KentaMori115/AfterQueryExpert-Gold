import { NextRequest, NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth-middleware"
import { getWebhookDeliveries } from "@/lib/webhook"

export async function GET(req: NextRequest) {
    const auth = await authenticateRequest(req)
    if (!auth.authenticated || !auth.userId) {
        return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 })
    }

    try {
        const deliveries = await getWebhookDeliveries(auth.userId, 50)
        return NextResponse.json({ deliveries })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to fetch webhook deliveries" }, { status: 500 })
    }
}

import { NextRequest, NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth-middleware"
import { deleteWebhookEndpoint, resumeWebhookEndpoint } from "@/lib/webhook"

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await authenticateRequest(req)
    if (!auth.authenticated || !auth.userId) {
        return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 })
    }

    const { id } = await params

    try {
        const success = await deleteWebhookEndpoint(auth.userId, id)
        if (!success) {
            return NextResponse.json({ error: "Webhook endpoint not found or access denied" }, { status: 404 })
        }
        return NextResponse.json({ success: true, message: "Webhook endpoint deleted successfully" })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to delete webhook endpoint" }, { status: 500 })
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await authenticateRequest(req)
    if (!auth.authenticated || !auth.userId) {
        return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 })
    }

    const { id } = await params

    try {
        const resumed = await resumeWebhookEndpoint(auth.userId, id)
        if (!resumed) {
            return NextResponse.json(
                { error: "Webhook endpoint not found or access denied" },
                { status: 404 }
            )
        }
        return NextResponse.json({ success: true, message: "Cooldown cleared" })
    } catch (err: any) {
        return NextResponse.json(
            { error: err.message || "Failed to resume webhook endpoint" },
            { status: 500 }
        )
    }
}

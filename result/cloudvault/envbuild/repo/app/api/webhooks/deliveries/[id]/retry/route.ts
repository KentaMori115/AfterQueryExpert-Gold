import { NextRequest, NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth-middleware"
import { getUserWebhookEndpoints, sendWebhookDelivery } from "@/lib/webhook"
import { getFirestore } from "firebase-admin/firestore"

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await authenticateRequest(req)
    if (!auth.authenticated || !auth.userId) {
        return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 })
    }

    const { id } = await params

    try {
        const db = getFirestore()
        const deliverySnap = await db.collection("webhook_deliveries").doc(id).get()

        if (!deliverySnap.exists || deliverySnap.data()?.userId !== auth.userId) {
            return NextResponse.json({ error: "Webhook delivery log not found" }, { status: 404 })
        }

        const deliveryData = deliverySnap.data() as any
        const endpoints = await getUserWebhookEndpoints(auth.userId)
        const endpoint = endpoints.find((e) => e.id === deliveryData.endpointId)

        if (!endpoint) {
            return NextResponse.json({ error: "Target webhook endpoint no longer exists" }, { status: 404 })
        }

        const retryResult = await sendWebhookDelivery(endpoint, deliveryData.event, deliveryData.payload)
        return NextResponse.json({ delivery: retryResult })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to retry webhook delivery" }, { status: 500 })
    }
}

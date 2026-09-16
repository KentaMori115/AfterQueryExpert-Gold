import { NextRequest, NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth-middleware"
import { getFirestore } from "firebase-admin/firestore"

export async function GET(
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
        const shareSnap = await db.collection("shares").doc(id).get()

        if (!shareSnap.exists || shareSnap.data()?.userId !== auth.userId) {
            return NextResponse.json({ error: "Share link not found or access denied" }, { status: 404 })
        }

        const auditsSnap = await db
            .collection("share_audits")
            .where("shareId", "==", id)
            .get()

        const audits = auditsSnap.docs.map((doc) => {
            const data = doc.data() as any
            return {
                id: doc.id,
                shareId: data.shareId,
                fileId: data.fileId,
                ip: data.ip || "Unknown",
                userAgent: data.userAgent || "Unknown",
                timestamp: data.timestamp?.toDate?.() || new Date(),
            }
        })

        audits.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

        return NextResponse.json({ audits })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to fetch share analytics" }, { status: 500 })
    }
}

import { NextRequest, NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth-middleware"
import { revokeShareLink } from "@/lib/share-manager"

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
        const success = await revokeShareLink(auth.userId, id)
        if (!success) {
            return NextResponse.json({ error: "Share link not found or access denied" }, { status: 404 })
        }
        return NextResponse.json({ success: true, message: "Share link revoked successfully" })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to revoke share link" }, { status: 500 })
    }
}

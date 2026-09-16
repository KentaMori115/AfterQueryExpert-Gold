import { NextRequest, NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth-middleware"
import { verifyWorkspaceAccess } from "@/lib/workspace-rbac"
import { getFirestore } from "firebase-admin/firestore"

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string; memberId: string }> }
) {
    const auth = await authenticateRequest(req)
    if (!auth.authenticated || !auth.userId) {
        return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 })
    }

    const { id, memberId } = await params

    const isAdmin = await verifyWorkspaceAccess(id, auth.userId, "admin")
    if (!isAdmin) {
        return NextResponse.json({ error: "Admin role required to remove members" }, { status: 403 })
    }

    try {
        await getFirestore().collection("workspace_members").doc(memberId).delete()
        return NextResponse.json({ success: true, message: "Member removed from workspace" })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to remove member" }, { status: 500 })
    }
}

import { NextRequest, NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth-middleware"
import { verifyWorkspaceAccess } from "@/lib/workspace-rbac"
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

    const hasAccess = await verifyWorkspaceAccess(id, auth.userId, "viewer")
    if (!hasAccess) {
        return NextResponse.json({ error: "Access denied to workspace" }, { status: 403 })
    }

    try {
        const snap = await getFirestore().collection("workspaces").doc(id).get()
        if (!snap.exists) {
            return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
        }
        return NextResponse.json({ workspace: { id: snap.id, ...snap.data() } })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to fetch workspace details" }, { status: 500 })
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await authenticateRequest(req)
    if (!auth.authenticated || !auth.userId) {
        return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 })
    }

    const { id } = await params

    const isOwner = await verifyWorkspaceAccess(id, auth.userId, "owner")
    if (!isOwner) {
        return NextResponse.json({ error: "Only the workspace owner can delete it" }, { status: 403 })
    }

    try {
        await getFirestore().collection("workspaces").doc(id).delete()
        return NextResponse.json({ success: true, message: "Workspace deleted" })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to delete workspace" }, { status: 500 })
    }
}

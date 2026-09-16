import { NextRequest, NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth-middleware"
import { getWorkspaceMembers, inviteWorkspaceMember, verifyWorkspaceAccess, WorkspaceRole } from "@/lib/workspace-rbac"

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
        return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    try {
        const members = await getWorkspaceMembers(id)
        return NextResponse.json({ members })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to fetch workspace members" }, { status: 500 })
    }
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await authenticateRequest(req)
    if (!auth.authenticated || !auth.userId) {
        return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 })
    }

    const { id } = await params

    const isAdmin = await verifyWorkspaceAccess(id, auth.userId, "admin")
    if (!isAdmin) {
        return NextResponse.json({ error: "Admin role required to invite members" }, { status: 403 })
    }

    try {
        const body = await req.json()
        const { email, role } = body

        if (!email || typeof email !== "string" || !email.includes("@")) {
            return NextResponse.json({ error: "Valid email address required" }, { status: 400 })
        }

        const validRole: WorkspaceRole = ["admin", "editor", "viewer"].includes(role) ? role : "viewer"
        const member = await inviteWorkspaceMember(id, email, validRole)

        return NextResponse.json({ member }, { status: 201 })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to invite member" }, { status: 500 })
    }
}

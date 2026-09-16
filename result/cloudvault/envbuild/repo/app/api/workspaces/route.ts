import { NextRequest, NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth-middleware"
import { createWorkspace, getUserWorkspaces } from "@/lib/workspace-rbac"

export async function GET(req: NextRequest) {
    const auth = await authenticateRequest(req)
    if (!auth.authenticated || !auth.userId) {
        return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 })
    }

    try {
        const workspaces = await getUserWorkspaces(auth.userId)
        return NextResponse.json({ workspaces })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to fetch workspaces" }, { status: 500 })
    }
}

export async function POST(req: NextRequest) {
    const auth = await authenticateRequest(req)
    if (!auth.authenticated || !auth.userId) {
        return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 })
    }

    try {
        const body = await req.json()
        const { name } = body

        if (!name || typeof name !== "string" || name.trim() === "") {
            return NextResponse.json({ error: "Workspace name is required" }, { status: 400 })
        }

        const workspace = await createWorkspace(auth.userId, name)
        return NextResponse.json({ workspace }, { status: 201 })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to create workspace" }, { status: 500 })
    }
}

import { NextRequest } from "next/server"
import { verifyWorkspaceAccess, WorkspaceRole } from "./workspace-rbac"

export async function authorizeWorkspaceRequest(
    req: NextRequest,
    userId: string,
    requiredRole: WorkspaceRole = "viewer"
): Promise<{ authorized: boolean; workspaceId?: string; error?: string }> {
    const workspaceId = req.headers.get("x-workspace-id") || req.nextUrl.searchParams.get("workspaceId")

    if (!workspaceId) {
        // Default to personal workspace context if no workspace specified
        return { authorized: true }
    }

    const hasAccess = await verifyWorkspaceAccess(workspaceId, userId, requiredRole)
    if (!hasAccess) {
        return { authorized: false, workspaceId, error: "Forbidden: Insufficient workspace permissions" }
    }

    return { authorized: true, workspaceId }
}

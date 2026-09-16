import { getFirestore, FieldValue } from "firebase-admin/firestore"

function getAdminDb() {
    return getFirestore()
}

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer"

export interface Workspace {
    id: string
    name: string
    ownerId: string
    createdAt: Date
    updatedAt: Date
}

export interface WorkspaceMember {
    id: string
    workspaceId: string
    userId: string
    email: string
    role: WorkspaceRole
    joinedAt: Date
}

/**
 * Creates a new workspace and sets creator as 'owner'.
 */
export async function createWorkspace(ownerId: string, name: string): Promise<Workspace> {
    const data = {
        name: name.trim(),
        ownerId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    }

    const docRef = await getAdminDb().collection("workspaces").add(data)

    // Add owner as workspace member
    await getAdminDb().collection("workspace_members").add({
        workspaceId: docRef.id,
        userId: ownerId,
        email: "",
        role: "owner",
        joinedAt: FieldValue.serverTimestamp(),
    })

    return {
        id: docRef.id,
        name: name.trim(),
        ownerId,
        createdAt: new Date(),
        updatedAt: new Date(),
    }
}

/**
 * Retrieves all workspaces accessible to a user.
 */
export async function getUserWorkspaces(userId: string): Promise<Workspace[]> {
    try {
        const membersSnap = await getAdminDb()
            .collection("workspace_members")
            .where("userId", "==", userId)
            .get()

        const workspaceIds = membersSnap.docs.map((d) => d.data().workspaceId)
        if (workspaceIds.length === 0) return []

        const workspacesSnap = await getAdminDb().collection("workspaces").get()
        const allWorkspaces = workspacesSnap.docs
            .filter((doc) => workspaceIds.includes(doc.id))
            .map((doc) => {
                const d = doc.data() as any
                return {
                    id: doc.id,
                    name: d.name || "Untitled Workspace",
                    ownerId: d.ownerId,
                    createdAt: d.createdAt?.toDate?.() || new Date(),
                    updatedAt: d.updatedAt?.toDate?.() || new Date(),
                }
            })

        return allWorkspaces
    } catch (err) {
        console.error("Failed to list user workspaces:", err)
        return []
    }
}

/**
 * Adds or invites a member to a workspace.
 */
export async function inviteWorkspaceMember(
    workspaceId: string,
    email: string,
    role: WorkspaceRole
): Promise<WorkspaceMember> {
    const data = {
        workspaceId,
        userId: "invited_" + Date.now(),
        email: email.trim().toLowerCase(),
        role,
        joinedAt: FieldValue.serverTimestamp(),
    }

    const docRef = await getAdminDb().collection("workspace_members").add(data)

    return {
        id: docRef.id,
        workspaceId,
        userId: data.userId,
        email: data.email,
        role,
        joinedAt: new Date(),
    }
}

/**
 * Gets all members of a workspace.
 */
export async function getWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    try {
        const snap = await getAdminDb()
            .collection("workspace_members")
            .where("workspaceId", "==", workspaceId)
            .get()

        return snap.docs.map((doc) => {
            const d = doc.data() as any
            return {
                id: doc.id,
                workspaceId: d.workspaceId,
                userId: d.userId,
                email: d.email || "",
                role: d.role || "viewer",
                joinedAt: d.joinedAt?.toDate?.() || new Date(),
            }
        })
    } catch (err) {
        console.error("Failed to list workspace members:", err)
        return []
    }
}

/**
 * Checks if a user has at least the required role level in a workspace.
 */
export async function verifyWorkspaceAccess(
    workspaceId: string,
    userId: string,
    requiredRole: WorkspaceRole = "viewer"
): Promise<boolean> {
    try {
        const snap = await getAdminDb()
            .collection("workspace_members")
            .where("workspaceId", "==", workspaceId)
            .where("userId", "==", userId)
            .limit(1)
            .get()

        if (snap.empty) return false

        const member = snap.docs[0].data() as any
        const roleHierarchy: Record<WorkspaceRole, number> = {
            owner: 4,
            admin: 3,
            editor: 2,
            viewer: 1,
        }

        const userLevel = roleHierarchy[member.role as WorkspaceRole] || 0
        const requiredLevel = roleHierarchy[requiredRole] || 1

        return userLevel >= requiredLevel
    } catch (err) {
        console.error("Failed to verify workspace permission:", err)
        return false
    }
}

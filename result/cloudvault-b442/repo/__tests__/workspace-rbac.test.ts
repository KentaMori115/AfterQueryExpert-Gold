import { WorkspaceRole } from "../lib/workspace-rbac"

describe("Workspace RBAC Hierarchy Logic", () => {
    it("evaluates role levels correctly", () => {
        const roleHierarchy: Record<WorkspaceRole, number> = {
            owner: 4,
            admin: 3,
            editor: 2,
            viewer: 1,
        }

        expect(roleHierarchy["owner"]).toBeGreaterThan(roleHierarchy["admin"])
        expect(roleHierarchy["admin"]).toBeGreaterThan(roleHierarchy["editor"])
        expect(roleHierarchy["editor"]).toBeGreaterThan(roleHierarchy["viewer"])
    })
})

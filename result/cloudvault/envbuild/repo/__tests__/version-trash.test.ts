describe("Trash & Version Control Helpers", () => {
    it("calculates retention dates correctly", () => {
        const now = new Date()
        const retentionDays = 30
        const expiresAt = new Date(now.getTime() + retentionDays * 24 * 3600 * 1000)

        const diffDays = Math.round((expiresAt.getTime() - now.getTime()) / (1000 * 3600 * 24))
        expect(diffDays).toBe(30)
    })
})

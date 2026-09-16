import bcrypt from "bcrypt"

describe("Share Password Hashing & Security", () => {
    it("hashes password correctly and verifies bcrypt match", async () => {
        const pass = "secret123"
        const hash = await bcrypt.hash(pass, 10)

        expect(hash).not.toBe(pass)
        const match = await bcrypt.compare(pass, hash)
        const wrongMatch = await bcrypt.compare("wrongpass", hash)

        expect(match).toBe(true)
        expect(wrongMatch).toBe(false)
    })
})

import { generateShareToken, verifyShareToken } from "../lib/share-utils"

const ORIGINAL_SECRET = process.env.SHARE_SECRET

beforeEach(() => {
    process.env.SHARE_SECRET = "test-share-secret"
})

afterAll(() => {
    if (ORIGINAL_SECRET === undefined) {
        delete process.env.SHARE_SECRET
    } else {
        process.env.SHARE_SECRET = ORIGINAL_SECRET
    }
})

describe("generateShareToken", () => {
    it("produces a two-part base64url token with a signature", () => {
        const token = generateShareToken("file-123", 3600)
        const parts = token.split(".")
        expect(parts).toHaveLength(2)
        expect(parts[0]).toMatch(/^[A-Za-z0-9_-]+$/)
        expect(parts[1]).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it("throws when SHARE_SECRET is not configured", () => {
        delete process.env.SHARE_SECRET
        expect(() => generateShareToken("file-123", 3600)).toThrow(/SHARE_SECRET/)
    })
})

describe("verifyShareToken", () => {
    it("returns the payload for a valid unexpired token", () => {
        const token = generateShareToken("file-123", 3600)
        const payload = verifyShareToken(token)
        expect(payload).not.toBeNull()
        expect(payload!.fileId).toBe("file-123")
        expect(payload!.expiresAt).toBeGreaterThan(Date.now())
    })

    it("returns null for a tampered signature", () => {
        const token = generateShareToken("file-123", 3600)
        const [payload, signature] = token.split(".")
        const flipped = payload.split("").reverse().join("")
        expect(verifyShareToken(`${flipped}.${signature}`)).toBeNull()
    })

    it("returns null for an expired token", () => {
        const token = generateShareToken("file-123", -10)
        expect(verifyShareToken(token)).toBeNull()
    })

    it("returns null for malformed tokens", () => {
        expect(verifyShareToken("not-a-token")).toBeNull()
        expect(verifyShareToken("")).toBeNull()
        expect(verifyShareToken("one.two.three")).toBeNull()
    })
})
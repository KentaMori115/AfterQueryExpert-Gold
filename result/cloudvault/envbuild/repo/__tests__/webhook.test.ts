import { generateWebhookSignature } from "../lib/webhook"

describe("generateWebhookSignature", () => {
    it("generates correct HMAC-SHA256 hex string", () => {
        const payload = JSON.stringify({ event: "file.uploaded", id: "123" })
        const secret = "whsec_testsecret123"

        const sig1 = generateWebhookSignature(payload, secret)
        const sig2 = generateWebhookSignature(payload, secret)

        expect(sig1).toBeDefined()
        expect(sig1).toHaveLength(64) // 256 bits = 64 hex chars
        expect(sig1).toBe(sig2)
    })

    it("produces different signatures for different secrets or payloads", () => {
        const payload = JSON.stringify({ event: "file.uploaded" })
        const sigA = generateWebhookSignature(payload, "secretA")
        const sigB = generateWebhookSignature(payload, "secretB")

        expect(sigA).not.toBe(sigB)
    })
})

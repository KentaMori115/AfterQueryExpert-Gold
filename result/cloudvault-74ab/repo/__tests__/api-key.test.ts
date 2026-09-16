import {
    generateApiKey,
    isApiKeyFormatValid,
    extractBearerToken,
    buildRateLimitKey,
} from "../lib/api-key"

describe("generateApiKey", () => {
    it("starts with the cvk_ prefix", () => {
        expect(generateApiKey().startsWith("cvk_")).toBe(true)
    })

    it("contains 32 hex characters after the prefix", () => {
        const key = generateApiKey()
        expect(key).toMatch(/^cvk_[0-9a-f]{32}$/)
    })

    it("produces unique keys", () => {
        const keys = new Set(Array.from({ length: 100 }, () => generateApiKey()))
        expect(keys.size).toBe(100)
    })

    it("contains no dashes", () => {
        expect(generateApiKey()).not.toContain("-")
    })

    it("produces a stable length", () => {
        expect(generateApiKey().length).toBe(4 + 32)
    })
})

describe("isApiKeyFormatValid", () => {
    it("accepts a valid generated key", () => {
        expect(isApiKeyFormatValid(generateApiKey())).toBe(true)
    })

    it("rejects a key with the wrong prefix", () => {
        expect(isApiKeyFormatValid("foo_0123456789abcdef0123456789abcdef")).toBe(false)
    })

    it("rejects keys that are too short", () => {
        expect(isApiKeyFormatValid("cvk_abc")).toBe(false)
    })

    it("rejects keys with uppercase hex", () => {
        expect(isApiKeyFormatValid("cvk_ABCDEFABCDEFABCDEFABCDEFABCDEFAB")).toBe(false)
    })

    it("rejects keys with non-hex characters", () => {
        expect(isApiKeyFormatValid("cvk_0123456789abcdef0123456789zzzz")).toBe(false)
    })

    it("rejects empty strings", () => {
        expect(isApiKeyFormatValid("")).toBe(false)
    })

    it("rejects keys with dashes", () => {
        expect(isApiKeyFormatValid("cvk_01234567-89ab-cdef-0123-456789abcdef")).toBe(false)
    })
})

describe("extractBearerToken", () => {
    it("extracts a Bearer token", () => {
        expect(extractBearerToken("Bearer abc123")).toBe("abc123")
    })

    it("returns null for missing headers", () => {
        expect(extractBearerToken(null)).toBeNull()
        expect(extractBearerToken(undefined as unknown as string)).toBeNull()
    })

    it("returns null for empty headers", () => {
        expect(extractBearerToken("")).toBeNull()
    })

    it("returns null for non-Bearer schemes", () => {
        expect(extractBearerToken("Basic abc123")).toBeNull()
    })

    it("trims surrounding whitespace", () => {
        expect(extractBearerToken("Bearer   abc123  ")).toBe("abc123")
    })

    it("returns null when nothing follows Bearer", () => {
        expect(extractBearerToken("Bearer ")).toBeNull()
        expect(extractBearerToken("Bearer")).toBeNull()
    })

    it("is case-sensitive on the scheme", () => {
        expect(extractBearerToken("bearer abc123")).toBeNull()
    })
})

describe("buildRateLimitKey", () => {
    it("prefixes the identifier", () => {
        expect(buildRateLimitKey("1.2.3.4")).toBe("rateLimit:1.2.3.4")
    })

    it("handles the unknown fallback identifier", () => {
        expect(buildRateLimitKey("unknown")).toBe("rateLimit:unknown")
    })

    it("handles ipv6-style identifiers", () => {
        expect(buildRateLimitKey("2001:db8::1")).toBe("rateLimit:2001:db8::1")
    })

    it("produces distinct keys for distinct identifiers", () => {
        const a = buildRateLimitKey("a")
        const b = buildRateLimitKey("b")
        expect(a).not.toBe(b)
    })
})
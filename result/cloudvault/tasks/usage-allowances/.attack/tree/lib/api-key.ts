// Pure API key helpers.

import { v4 as uuidv4 } from "uuid"

const API_KEY_PREFIX = "cvk_"
const API_KEY_PATTERN = /^cvk_[0-9a-f]{32}$/

export function generateApiKey(): string {
    return `${API_KEY_PREFIX}${uuidv4().replace(/-/g, "")}`
}

export function isApiKeyFormatValid(apiKey: string): boolean {
    return API_KEY_PATTERN.test(apiKey)
}

export function extractBearerToken(authHeader: string | null): string | null {
    if (!authHeader) return null
    const prefix = "Bearer "
    if (!authHeader.startsWith(prefix)) return null
    const token = authHeader.slice(prefix.length).trim()
    return token || null
}

export function buildRateLimitKey(identifier: string): string {
    return `rateLimit:${identifier}`
}
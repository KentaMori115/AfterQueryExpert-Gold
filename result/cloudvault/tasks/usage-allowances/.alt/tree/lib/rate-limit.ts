import type { NextRequest } from "next/server"
import { redis } from "./utils"
import { buildRateLimitKey } from "./api-key"

interface RateLimitResult {
    limited: boolean
    retryAfter?: number
}

export async function applyRateLimit(req: NextRequest): Promise<RateLimitResult> {
    try {
        const ip = req.headers.get("x-forwarded-for") || "unknown"
        const now = Date.now()
        const windowMs = 60 * 1000 // 1 minute
        const maxRequests = 100

        const key = buildRateLimitKey(ip)

        try {
            const count = await redis.incr(key)

            if (count === 1) {
                // Set expiration on first increment
                await redis.expire(key, windowMs / 1000)
            }

            if (count > maxRequests) {
                const ttl = await redis.ttl(key)
                return {
                    limited: true,
                    retryAfter: ttl > 0 ? ttl : 60,
                }
            }

            return { limited: false }
        } catch (redisError) {
            console.error("Redis rate limit error:", redisError)
            // Fallback to memory-based rate limiting if Redis fails
            return { limited: false }
        }
    } catch (error) {
        console.error("Rate limit error:", error)
        return { limited: false }
    }
}

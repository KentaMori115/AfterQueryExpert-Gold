import { Redis } from "@upstash/redis"
import type { NextRequest } from "next/server"
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { buildRateLimitKey } from "./api-key"

// Initialize Upstash Redis client
export const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || "",
    token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
})

export const rateLimit = {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100, // Max 100 requests per minute
}

export async function applyRateLimit(request: NextRequest) {
    const ip = request.headers.get("x-forwarded-for") || "127.0.0.1"
    const key = buildRateLimitKey(ip)

    try {
        const count = await redis.incr(key)

        if (count === 1) {
            // Set expiration on first increment
            await redis.expire(key, rateLimit.windowMs / 1000)
        }

        if (count > rateLimit.maxRequests) {
            const ttl = await redis.ttl(key)
            return {
                limited: true,
                retryAfter: ttl > 0 ? ttl : 60,
            }
        }

        return { limited: false }
    } catch (error) {
        console.error("Redis Error:", error)
        return { limited: false } // Don't block requests if Redis is unavailable
    }
}

export { generateApiKey } from "./api-key"

// Utility function to combine class names (for Tailwind)
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export type TokenBucket = {
  tokens: number
  lastRefillAt: number
}

export function refillBucket(
  bucket: TokenBucket,
  now: number,
  capacity: number,
  refillPerMs: number
) {
  if (now < bucket.lastRefillAt) {
    return bucket
  }
  const elapsed = now - bucket.lastRefillAt
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs)
  bucket.lastRefillAt = now
  return bucket
}

export function takeToken(bucket: TokenBucket, cost = 1) {
  if (bucket.tokens + 1e-9 < cost) {
    return false
  }
  bucket.tokens -= cost
  return true
}

export function msUntilToken(bucket: TokenBucket, refillPerMs: number, cost = 1) {
  if (bucket.tokens >= cost) return 0
  if (refillPerMs <= 0) return Number.POSITIVE_INFINITY
  return Math.ceil((cost - bucket.tokens) / refillPerMs)
}

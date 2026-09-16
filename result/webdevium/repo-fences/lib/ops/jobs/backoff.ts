export type BackoffPolicy = {
  baseMs: number
  factor: number
  maxMs: number
  jitterRatio: number
}

export function delayForAttempt(attempt: number, policy: BackoffPolicy, seed: number) {
  const exp = Math.min(policy.maxMs, policy.baseMs * policy.factor ** Math.max(0, attempt - 1))
  const unit = Math.abs(Math.sin(seed * 12.9898 + attempt * 78.233))
  const jitter = exp * policy.jitterRatio * (unit * 2 - 1)
  return Math.max(0, Math.round(exp + jitter))
}

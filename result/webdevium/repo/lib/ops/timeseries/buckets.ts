export type BucketSize = 'minute' | 'hour' | 'day'

const SIZE_MS: Record<BucketSize, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
}

export function alignUtc(at: number, size: BucketSize) {
  const width = SIZE_MS[size]
  return Math.floor(at / width) * width
}

export function bucketKey(at: number, size: BucketSize) {
  return `${size}:${alignUtc(at, size)}`
}

export type Sample = {
  at: number
  value: number
}

export type Bucket = {
  start: number
  end: number
  sum: number
  count: number
  min: number
  max: number
}

export function rollup(samples: Sample[], size: BucketSize, from: number, to: number): Bucket[] {
  if (to <= from) throw new Error('Range end must be after start')
  const width = SIZE_MS[size]
  const start = alignUtc(from, size)
  const buckets = new Map<number, Bucket>()

  for (let cursor = start; cursor < to; cursor += width) {
    buckets.set(cursor, {
      start: cursor,
      end: cursor + width,
      sum: 0,
      count: 0,
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
    })
  }

  for (const sample of samples) {
    if (sample.at < from || sample.at >= to) continue
    const key = alignUtc(sample.at, size)
    const bucket = buckets.get(key)
    if (!bucket) continue
    bucket.sum += sample.value
    bucket.count += 1
    bucket.min = Math.min(bucket.min, sample.value)
    bucket.max = Math.max(bucket.max, sample.value)
  }

  return [...buckets.values()].map((bucket) =>
    bucket.count === 0
      ? { ...bucket, min: 0, max: 0 }
      : bucket
  )
}

export function average(bucket: Bucket) {
  return bucket.count === 0 ? 0 : bucket.sum / bucket.count
}

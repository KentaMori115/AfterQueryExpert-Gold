import { customAlphabet } from 'nanoid'

const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const nano = customAlphabet(alphabet, 10)

export function generateId(prefix: string): string {
  return `${prefix}_${nano()}`
}

export function isLikelyId(value: string, prefix?: string): boolean {
  if (typeof value !== 'string' || value.length < 4) return false
  const parts = value.split('_')
  if (parts.length !== 2) return false
  const [p, body] = parts
  if (prefix && p !== prefix) return false
  if (!body || body.length < 6) return false
  for (const ch of body) {
    if (!alphabet.includes(ch)) return false
  }
  return true
}

export function shortId(value: string): string {
  const idx = value.indexOf('_')
  if (idx === -1) return value.slice(0, 6)
  return value.slice(idx + 1, idx + 7)
}

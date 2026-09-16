export function titleCase(value: string): string {
  if (!value) return ''
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ')
}

export function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return `${count} ${singular}`
  return `${count} ${plural ?? singular + 's'}`
}

export function truncate(value: string, max = 80, suffix = '...'): string {
  if (value.length <= max) return value
  return value.slice(0, Math.max(0, max - suffix.length)).trimEnd() + suffix
}

export function joinWithAnd(parts: readonly string[]): string {
  const cleaned = parts.filter((p) => p && p.trim().length > 0)
  if (cleaned.length === 0) return ''
  if (cleaned.length === 1) return cleaned[0]!
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`
  return `${cleaned.slice(0, -1).join(', ')}, and ${cleaned[cleaned.length - 1]}`
}

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

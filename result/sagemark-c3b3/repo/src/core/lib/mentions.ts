// Mentions take the form [[Name]] in free text. We try to resolve them to
// entity ids by matching case-insensitive on names in a supplied directory.

export interface MentionTarget {
  kind: 'character' | 'faction' | 'location' | 'arc' | 'quest' | 'lore'
  id: string
  name: string
}

export interface MentionDirectory {
  characters?: ReadonlyArray<MentionTarget>
  factions?: ReadonlyArray<MentionTarget>
  locations?: ReadonlyArray<MentionTarget>
  arcs?: ReadonlyArray<MentionTarget>
  quests?: ReadonlyArray<MentionTarget>
  lore?: ReadonlyArray<MentionTarget>
}

export interface ResolvedMention {
  raw: string
  match: string
  target: MentionTarget | null
}

const MENTION_PATTERN = /\[\[([^\]\n]+)\]\]/g

export function extractMentions(text: string): string[] {
  if (!text) return []
  const out: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  MENTION_PATTERN.lastIndex = 0
  while ((m = MENTION_PATTERN.exec(text)) !== null) {
    const inner = m[1]!.trim()
    if (inner && !seen.has(inner.toLowerCase())) {
      seen.add(inner.toLowerCase())
      out.push(inner)
    }
  }
  return out
}

export function resolveMentions(text: string, directory: MentionDirectory): ResolvedMention[] {
  const mentions = extractMentions(text)
  return mentions.map((raw) => ({
    raw,
    match: `[[${raw}]]`,
    target: findInDirectory(raw, directory),
  }))
}

function findInDirectory(name: string, directory: MentionDirectory): MentionTarget | null {
  const lc = name.toLowerCase()
  const order: Array<keyof MentionDirectory> = [
    'characters',
    'factions',
    'locations',
    'arcs',
    'quests',
    'lore',
  ]
  for (const kind of order) {
    const list = directory[kind]
    if (!list) continue
    for (const candidate of list) {
      if (candidate.name.toLowerCase() === lc) return candidate
    }
  }
  return null
}

export function backlinksTo(target: MentionTarget, sources: ReadonlyArray<{ id: string; text: string }>):
  Array<{ id: string }> {
  const lc = target.name.toLowerCase()
  return sources.filter((s) => {
    const mentions = extractMentions(s.text)
    return mentions.some((m) => m.toLowerCase() === lc)
  })
}

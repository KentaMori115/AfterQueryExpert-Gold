import { describe, expect, it } from 'vitest'

import {
  type MentionDirectory,
  backlinksTo,
  extractMentions,
  resolveMentions,
} from './mentions'

const directory: MentionDirectory = {
  characters: [{ kind: 'character', id: 'char_A', name: 'Iris Thorne' }],
  factions: [{ kind: 'faction', id: 'fac_A', name: 'Iron Hand' }],
  locations: [{ kind: 'location', id: 'loc_A', name: 'Frozen Gate' }],
}

describe('extractMentions', () => {
  it('returns empty for empty input', () => {
    expect(extractMentions('')).toEqual([])
  })

  it('picks up single mention', () => {
    expect(extractMentions('hello [[Iris]] there')).toEqual(['Iris'])
  })

  it('handles multiple mentions', () => {
    expect(extractMentions('[[Iris]] and [[Brann]] arrived')).toEqual(['Iris', 'Brann'])
  })

  it('dedupes case insensitively', () => {
    expect(extractMentions('[[Iris]] and [[iris]] and [[IRIS]]')).toEqual(['Iris'])
  })

  it('ignores newlines inside brackets', () => {
    expect(extractMentions('[[good\nline]]')).toEqual([])
  })
})

describe('resolveMentions', () => {
  it('resolves names to targets case insensitively', () => {
    const resolved = resolveMentions('see [[iris thorne]] here', directory)
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.target?.id).toBe('char_A')
  })

  it('returns null target when nothing matches', () => {
    const resolved = resolveMentions('see [[Unknown]] here', directory)
    expect(resolved[0]?.target).toBe(null)
  })

  it('prefers characters when a name appears in multiple kinds', () => {
    const overlapping: MentionDirectory = {
      characters: [{ kind: 'character', id: 'char_A', name: 'Frost' }],
      locations: [{ kind: 'location', id: 'loc_A', name: 'Frost' }],
    }
    const resolved = resolveMentions('[[Frost]]', overlapping)
    expect(resolved[0]?.target?.kind).toBe('character')
  })
})

describe('backlinksTo', () => {
  it('returns sources that mention the target', () => {
    const target = { kind: 'character', id: 'char_A', name: 'Iris' } as const
    const sources = [
      { id: 'note_1', text: 'find [[Iris]] before dawn' },
      { id: 'note_2', text: 'check the [[Frozen Gate]]' },
      { id: 'note_3', text: 'iris is missing' },
    ]
    const back = backlinksTo(target, sources)
    expect(back.map((b) => b.id)).toEqual(['note_1'])
  })

  it('is case insensitive on names', () => {
    const target = { kind: 'character', id: 'char_A', name: 'iris' } as const
    const sources = [{ id: 'note_1', text: 'meet [[IRIS]]' }]
    expect(backlinksTo(target, sources)).toHaveLength(1)
  })
})

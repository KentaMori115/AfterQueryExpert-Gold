import { describe, expect, it } from 'vitest'

import { ImportParseError, parseImport, previewImport } from './useImport'

const emptyV1 = {
  version: 1,
  exportedAt: '2026-01-01T00:00:00Z',
  campaignId: 'camp_X',
  campaign: { id: 'camp_X', name: 'X' },
  characters: [],
  factions: [],
  locations: [],
  sessions: [],
  arcs: [],
  encounters: [],
  relationships: [],
  lore: [],
  items: [],
  quests: [],
  timeline: [],
}

describe('parseImport', () => {
  it('parses a v1 bundle', () => {
    const data = parseImport(JSON.stringify(emptyV1))
    expect(data.version).toBe(1)
    expect(data.campaignId).toBe('camp_X')
  })

  it('parses a v2 bundle with module additions', () => {
    const v2 = {
      ...emptyV1,
      version: 2,
      notes: [{ id: 'n_1' }],
      tags: [{ id: 't_1' }],
      treasury: { purse: { cp: 0, sp: 0, ep: 0, gp: 5, pp: 0 }, entries: [] },
    }
    const data = parseImport(JSON.stringify(v2))
    expect(data.version).toBe(2)
    expect(data.notes).toHaveLength(1)
  })

  it('rejects non JSON input', () => {
    expect(() => parseImport('not json')).toThrow(ImportParseError)
  })

  it('rejects mismatched schemas', () => {
    expect(() => parseImport(JSON.stringify({ version: 99 }))).toThrow(ImportParseError)
  })
})

describe('previewImport', () => {
  it('returns module counts', () => {
    const v2 = {
      ...emptyV1,
      version: 2,
      characters: [{}, {}],
      tags: [{}, {}, {}],
    }
    const preview = previewImport(JSON.stringify(v2))
    expect(preview.version).toBe(2)
    expect(preview.counts.characters).toBe(2)
    expect(preview.counts.tags).toBe(3)
    expect(preview.modulesPresent).toContain('characters')
    expect(preview.modulesPresent).toContain('tags')
  })

  it('omits zero count modules from modulesPresent', () => {
    const preview = previewImport(JSON.stringify(emptyV1))
    expect(preview.modulesPresent).toEqual([])
  })
})

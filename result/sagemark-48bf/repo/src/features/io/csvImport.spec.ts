import { describe, expect, it } from 'vitest'

import { asCampaignId } from '@core/ids'

import { parseCharactersCsv } from './csvImport'

const camp = asCampaignId('camp_X')

describe('parseCharactersCsv', () => {
  it('rejects empty input', () => {
    const r = parseCharactersCsv('', camp)
    expect(r.ok).toBe(false)
  })

  it('rejects csv without a name column', () => {
    const r = parseCharactersCsv('foo,bar\n1,2', camp)
    expect(r.ok).toBe(false)
  })

  it('parses a minimal csv', () => {
    const r = parseCharactersCsv('name\nIris\nBrann', camp)
    expect(r.ok).toBe(true)
    expect(r.imported).toHaveLength(2)
    expect(r.imported[0]?.name).toBe('Iris')
  })

  it('parses extra columns', () => {
    const r = parseCharactersCsv('name,ancestry,level\nIris,human,5', camp)
    expect(r.ok).toBe(true)
    expect(r.imported[0]?.ancestry).toBe('human')
    expect(r.imported[0]?.level).toBe(5)
  })

  it('handles quoted commas', () => {
    const r = parseCharactersCsv('name,vocation\n"Iris, the Sharp",scout', camp)
    expect(r.ok).toBe(true)
    expect(r.imported[0]?.name).toBe('Iris, the Sharp')
  })

  it('reports per-row errors', () => {
    const r = parseCharactersCsv('name,level\nIris,9999', camp)
    expect(r.ok).toBe(false)
    expect(r.errors).toHaveLength(1)
  })

  it('rejects unknown kind', () => {
    const r = parseCharactersCsv('name,kind\nIris,monster', camp)
    expect(r.ok).toBe(false)
  })

  it('skips empty trailing lines', () => {
    const r = parseCharactersCsv('name\nIris\n\n\n', camp)
    expect(r.imported).toHaveLength(1)
  })
})

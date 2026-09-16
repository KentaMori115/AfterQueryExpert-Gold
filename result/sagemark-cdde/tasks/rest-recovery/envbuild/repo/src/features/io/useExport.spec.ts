import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useCampaignStore } from '@features/campaigns/store'
import { useNoteStore } from '@features/notes/store'
import { useTagStore } from '@features/tags/store'
import { useTreasuryStore } from '@features/treasury/store'

import { buildExport, exportAsJson, fileNameFor } from './useExport'

describe('buildExport', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('returns null when the campaign id resolves to nothing', () => {
    expect(buildExport('camp_missing' as never)).toBeNull()
  })

  it('produces a v2 bundle by default', () => {
    const camp = useCampaignStore().create({ name: 'Frostfall' })
    const dump = buildExport(camp.id as never)!
    expect(dump.version).toBe(2)
    expect(dump.campaignId).toBe(camp.id)
    expect(Array.isArray(dump.characters)).toBe(true)
    expect(Array.isArray(dump.notes)).toBe(true)
    expect(Array.isArray(dump.tags)).toBe(true)
    expect(Array.isArray(dump.holidays)).toBe(true)
    expect(Array.isArray(dump.downtime)).toBe(true)
    expect(dump.treasury).toBeDefined()
  })

  it('still produces a v1 bundle when asked', () => {
    const camp = useCampaignStore().create({ name: 'Frostfall' })
    const dump = buildExport(camp.id as never, 1)!
    expect(dump.version).toBe(1)
    expect(dump.notes).toBeUndefined()
    expect(dump.tags).toBeUndefined()
  })

  it('captures notes, tags and treasury entries from the matching stores', () => {
    const camp = useCampaignStore().create({ name: 'Frostfall' })
    useNoteStore().create({
      campaignId: camp.id,
      target: { kind: 'campaign', id: camp.id },
      title: 'Sticky',
      body: 'note',
    })
    useTagStore().create({ campaignId: camp.id as never, name: 'Iron' })
    useTreasuryStore().deposit(camp.id as never, { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 }, 'hoard')
    const dump = buildExport(camp.id as never)!
    expect(dump.notes).toHaveLength(1)
    expect(dump.tags).toHaveLength(1)
    expect(dump.treasury).toBeDefined()
    expect((dump.treasury as { purse: { gp: number } }).purse.gp).toBe(10)
  })
})

describe('exportAsJson', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('serialises to JSON when the campaign exists', () => {
    const camp = useCampaignStore().create({ name: 'Frostfall' })
    const json = exportAsJson(camp.id as never)!
    expect(json).toContain('"campaignId"')
  })

  it('returns null when no campaign matches', () => {
    expect(exportAsJson('camp_missing' as never)).toBeNull()
  })
})

describe('fileNameFor', () => {
  it('slugifies and stamps with the date', () => {
    expect(fileNameFor('The Frost Fall')).toMatch(/^the-frost-fall-\d{4}-\d{2}-\d{2}\.sagemark\.json$/)
  })

  it('falls back to a default slug for nameless inputs', () => {
    expect(fileNameFor('!!!')).toMatch(/^campaign-/)
  })
})

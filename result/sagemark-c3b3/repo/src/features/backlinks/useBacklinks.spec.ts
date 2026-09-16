import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId } from '@core/ids'
import { useCampaignStore } from '@features/campaigns/store'
import { useNoteStore } from '@features/notes/store'
import { useLoreStore } from '@features/lore/store'
import { useSessionStore } from '@features/sessions/store'

import { useBacklinks } from './useBacklinks'

describe('useBacklinks', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('returns empty when no campaign is set', () => {
    const { hits } = useBacklinks({ campaignId: () => null, targetName: () => 'Iris' })
    expect(hits.value).toEqual([])
  })

  it('returns empty when no target name', () => {
    const c = useCampaignStore().create({ name: 'X' })
    const { hits } = useBacklinks({
      campaignId: () => asCampaignId(c.id),
      targetName: () => '',
    })
    expect(hits.value).toEqual([])
  })

  it('finds notes mentioning the target by name', () => {
    const c = useCampaignStore().create({ name: 'X' })
    const target = asCharacterId('char_A')
    const notes = useNoteStore()
    notes.create({
      campaignId: c.id,
      target: { kind: 'character', id: target },
      body: 'remember to check on [[Iris]]',
    })
    const { hits } = useBacklinks({
      campaignId: () => asCampaignId(c.id),
      targetName: () => 'Iris',
    })
    expect(hits.value.some((h) => h.kind === 'note')).toBe(true)
  })

  it('finds lore entries mentioning the target', () => {
    const c = useCampaignStore().create({ name: 'X' })
    const lore = useLoreStore()
    lore.create({
      campaignId: c.id,
      title: 'Tale',
      body: 'long ago [[Iris]] founded the order',
    })
    const { hits } = useBacklinks({
      campaignId: () => asCampaignId(c.id),
      targetName: () => 'Iris',
    })
    expect(hits.value.some((h) => h.kind === 'lore')).toBe(true)
  })

  it('finds sessions mentioning the target', () => {
    const c = useCampaignStore().create({ name: 'X' })
    const sessions = useSessionStore()
    sessions.create({
      campaignId: c.id,
      title: 'Frostbite',
      playedAt: '2026-01-01T20:00:00Z',
      log: 'the party met [[Iris]]',
    })
    const { hits } = useBacklinks({
      campaignId: () => asCampaignId(c.id),
      targetName: () => 'Iris',
    })
    expect(hits.value.some((h) => h.kind === 'session')).toBe(true)
  })

  it('is case insensitive', () => {
    const c = useCampaignStore().create({ name: 'X' })
    const notes = useNoteStore()
    notes.create({
      campaignId: c.id,
      target: { kind: 'character', id: asCharacterId('char_A') },
      body: '[[iris]] was here',
    })
    const { hits } = useBacklinks({
      campaignId: () => asCampaignId(c.id),
      targetName: () => 'Iris',
    })
    expect(hits.value).toHaveLength(1)
  })
})

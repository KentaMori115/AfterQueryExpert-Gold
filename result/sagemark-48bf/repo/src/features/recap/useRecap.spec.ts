import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'
import { useQuestStore } from '@features/quests/store'
import { useSessionStore } from '@features/sessions/store'

import { recapAsMarkdown, useRecap, type RecapResult } from './useRecap'

function harness(campaignId: () => string | null) {
  const Harness = defineComponent({
    setup(_, { expose }) {
      const r = useRecap({ campaignId: () => (campaignId() ?? null) as never })
      expose({ recap: r.recap })
      return () => null
    },
  })
  return mount(Harness)
}

function api(wrapper: ReturnType<typeof harness>): { recap: RecapResult | null } {
  return wrapper.vm as unknown as { recap: RecapResult | null }
}

describe('useRecap', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('returns null when no campaign is selected', () => {
    const w = harness(() => null)
    expect(api(w).recap).toBeNull()
  })

  it('returns null when the campaign id does not resolve', () => {
    const w = harness(() => 'camp_missing')
    expect(api(w).recap).toBeNull()
  })

  it('summarises recent sessions in reverse chronological order', async () => {
    const camp = useCampaignStore().create({ name: 'Frostfall' })
    const sessions = useSessionStore()
    sessions.create({
      campaignId: camp.id,
      title: 'First',
      playedAt: new Date('2026-01-01').toISOString(),
      summary: 'opening summary',
    })
    sessions.create({
      campaignId: camp.id,
      title: 'Second',
      playedAt: new Date('2026-02-01').toISOString(),
      summary: 'follow up',
    })
    const w = harness(() => camp.id)
    await w.vm.$nextTick()
    const recap = api(w).recap!
    expect(recap.campaignName).toBe('Frostfall')
    const sessionSection = recap.sections.find((s) => s.title === 'Last sessions')
    expect(sessionSection?.bullets[0]!.text).toContain('Second')
  })

  it('counts mentions in session logs against the known cast', async () => {
    const camp = useCampaignStore().create({ name: 'Frostfall' })
    const characters = useCharacterStore()
    characters.create({ campaignId: camp.id, name: 'Iris Thorne', kind: 'pc' })
    const sessions = useSessionStore()
    sessions.create({
      campaignId: camp.id,
      title: 'S',
      playedAt: new Date().toISOString(),
      summary: 'Iris Thorne saved the day',
      log: 'After a long fight [[Iris Thorne]] saved the dog.',
    })
    const w = harness(() => camp.id)
    await w.vm.$nextTick()
    const recap = api(w).recap!
    const mentions = recap.sections.find((s) => s.title === 'Names that came up')
    expect(mentions).toBeDefined()
    expect(mentions!.bullets[0]!.text).toContain('Iris Thorne')
  })

  it('lists open quests', async () => {
    const camp = useCampaignStore().create({ name: 'Frostfall' })
    const quests = useQuestStore()
    quests.create({ campaignId: camp.id, title: 'Find the bell', status: 'accepted' })
    quests.create({ campaignId: camp.id, title: 'Burn the boat', status: 'completed' })
    const w = harness(() => camp.id)
    await w.vm.$nextTick()
    const recap = api(w).recap!
    const section = recap.sections.find((s) => s.title === 'Open quests')
    expect(section?.bullets.map((b) => b.text).join(' ')).toContain('Find the bell')
    expect(section?.bullets.map((b) => b.text).join(' ')).not.toContain('Burn the boat')
  })

  it('recapAsMarkdown writes a header per section', async () => {
    const camp = useCampaignStore().create({ name: 'Frostfall' })
    useSessionStore().create({
      campaignId: camp.id,
      title: 'Bell',
      playedAt: new Date().toISOString(),
      summary: 'they rang the bell',
    })
    const w = harness(() => camp.id)
    await w.vm.$nextTick()
    const recap = api(w).recap!
    const md = recapAsMarkdown(recap)
    expect(md).toContain('# Where we left off in Frostfall')
    expect(md).toContain('## Last sessions')
  })
})

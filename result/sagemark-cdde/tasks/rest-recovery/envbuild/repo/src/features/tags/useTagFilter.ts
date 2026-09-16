import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { CampaignId, TagId } from '@core/ids'
import type { Tag, TagTargetKind } from '@core/models/tag'

import { useCharacterStore } from '@features/characters/store'
import { useFactionStore } from '@features/factions/store'
import { useLocationStore } from '@features/locations/store'
import { useQuestStore } from '@features/quests/store'

import { useTagStore } from './store'

export type TagFilterMode = 'any' | 'all'

export interface TaggedTarget {
  kind: TagTargetKind
  id: string
  name: string
  routeTo: string
  tags: Tag[]
}

export interface UseTagFilterReturn {
  selected: Ref<ReadonlyArray<TagId>>
  mode: Ref<TagFilterMode>
  toggle: (id: TagId) => void
  clear: () => void
  results: ComputedRef<TaggedTarget[]>
  totals: ComputedRef<Record<TagTargetKind, number>>
}

export interface UseTagFilterOptions {
  campaignId: () => CampaignId | null
}

const EMPTY_TOTALS: Record<TagTargetKind, number> = {
  character: 0,
  faction: 0,
  location: 0,
  session: 0,
  arc: 0,
  encounter: 0,
  lore: 0,
  item: 0,
  quest: 0,
}

export function useTagFilter(opts: UseTagFilterOptions): UseTagFilterReturn {
  const tags = useTagStore()
  const characters = useCharacterStore()
  const factions = useFactionStore()
  const locations = useLocationStore()
  const quests = useQuestStore()

  const selected = ref<ReadonlyArray<TagId>>([])
  const mode = ref<TagFilterMode>('any')

  function toggle(id: TagId): void {
    if (selected.value.includes(id)) {
      selected.value = selected.value.filter((t) => t !== id)
    } else {
      selected.value = [...selected.value, id]
    }
  }

  function clear(): void {
    selected.value = []
  }

  const results = computed<TaggedTarget[]>(() => {
    const cid = opts.campaignId()
    if (!cid) return []
    if (selected.value.length === 0) return []
    const allTags = tags.forCampaign(cid)
    const lookup = new Map<TagId, Tag>(allTags.map((t) => [t.id, t]))
    const wanted = new Set(selected.value)

    const matched = new Map<string, TaggedTarget>()
    const addHit = (
      kind: TagTargetKind,
      id: string,
      name: string,
      routeTo: string,
      tag: Tag,
    ): void => {
      const key = `${kind}:${id}`
      const existing = matched.get(key)
      if (existing) {
        if (!existing.tags.some((t) => t.id === tag.id)) existing.tags.push(tag)
      } else {
        matched.set(key, { kind, id, name, routeTo, tags: [tag] })
      }
    }

    for (const tagId of wanted) {
      const tag = lookup.get(tagId)
      if (!tag) continue
      for (const a of tag.appliedTo) {
        switch (a.kind) {
          case 'character': {
            const c = characters.byId(a.id as never)
            if (c) addHit(a.kind, a.id, c.name, `/campaigns/${cid}/characters/${a.id}`, tag)
            break
          }
          case 'faction': {
            const f = factions.byId(a.id as never)
            if (f) addHit(a.kind, a.id, f.name, `/campaigns/${cid}/factions/${a.id}`, tag)
            break
          }
          case 'location': {
            const l = locations.byId(a.id as never)
            if (l) addHit(a.kind, a.id, l.name, `/campaigns/${cid}/locations/${a.id}`, tag)
            break
          }
          case 'quest': {
            const q = quests.byId(a.id as never)
            if (q) addHit(a.kind, a.id, q.title, `/campaigns/${cid}/quests`, tag)
            break
          }
          default:
            addHit(a.kind, a.id, a.id, `/campaigns/${cid}`, tag)
        }
      }
    }

    let hits = Array.from(matched.values())
    if (mode.value === 'all') {
      const needed = selected.value.length
      hits = hits.filter((h) => h.tags.length >= needed)
    }
    hits.sort((a, b) => {
      if (a.tags.length !== b.tags.length) return b.tags.length - a.tags.length
      return a.name.localeCompare(b.name)
    })
    return hits
  })

  const totals = computed<Record<TagTargetKind, number>>(() => {
    const out: Record<TagTargetKind, number> = { ...EMPTY_TOTALS }
    for (const hit of results.value) out[hit.kind] += 1
    return out
  })

  return { selected, mode, toggle, clear, results, totals }
}

import { computed, type ComputedRef } from 'vue'

import type { CampaignId } from '@core/ids'
import { type Tag, type TagTargetKind, attachedKinds } from '@core/models/tag'

import { useTagStore } from './store'

export interface TagStats {
  total: number
  unused: number
  mostUsed: { tag: Tag; count: number } | null
  byKind: Record<TagTargetKind, number>
  averageTargetsPerTag: number
}

const EMPTY_KIND_TALLY: Record<TagTargetKind, number> = {
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

export function useTagStats(opts: { campaignId: () => CampaignId | null }): {
  stats: ComputedRef<TagStats | null>
} {
  const tags = useTagStore()

  const stats = computed<TagStats | null>(() => {
    const cid = opts.campaignId()
    if (!cid) return null
    const list = tags.forCampaign(cid)
    if (list.length === 0) {
      return {
        total: 0,
        unused: 0,
        mostUsed: null,
        byKind: { ...EMPTY_KIND_TALLY },
        averageTargetsPerTag: 0,
      }
    }
    let unused = 0
    const kinds: Record<TagTargetKind, number> = { ...EMPTY_KIND_TALLY }
    let totalTargets = 0
    let mostUsed: { tag: Tag; count: number } | null = null
    for (const tag of list) {
      const count = tag.appliedTo.length
      totalTargets += count
      if (count === 0) unused += 1
      for (const target of tag.appliedTo) kinds[target.kind] += 1
      if (!mostUsed || count > mostUsed.count) mostUsed = { tag, count }
      void attachedKinds
    }
    return {
      total: list.length,
      unused,
      mostUsed,
      byKind: kinds,
      averageTargetsPerTag: Math.round((totalTargets / list.length) * 100) / 100,
    }
  })

  return { stats }
}

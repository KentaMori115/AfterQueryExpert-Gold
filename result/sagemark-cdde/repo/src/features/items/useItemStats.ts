import { computed, type ComputedRef } from 'vue'

import type { CampaignId, CharacterId } from '@core/ids'
import {
  ITEM_RARITIES,
  type ItemRarity,
} from '@core/models/item'

import { useItemStore } from './store'

export interface CampaignItemStats {
  total: number
  unclaimed: number
  magical: number
  byRarity: Record<ItemRarity, number>
  topOwner: { characterId: CharacterId; count: number } | null
  averageValue: number
}

const EMPTY_RARITY: Record<ItemRarity, number> = {
  common: 0,
  uncommon: 0,
  rare: 0,
  'very-rare': 0,
  legendary: 0,
  artifact: 0,
}

export function useItemStats(opts: { campaignId: () => CampaignId | null }): {
  stats: ComputedRef<CampaignItemStats | null>
} {
  const items = useItemStore()
  const stats = computed<CampaignItemStats | null>(() => {
    const cid = opts.campaignId()
    if (!cid) return null
    const list = items.forCampaign(cid)
    const byRarity: Record<ItemRarity, number> = { ...EMPTY_RARITY }
    let magical = 0
    let unclaimed = 0
    let totalValue = 0
    const owners = new Map<CharacterId, number>()
    for (const item of list) {
      if (item.magical) magical += 1
      if (item.ownerId === null) unclaimed += 1
      else owners.set(item.ownerId, (owners.get(item.ownerId) ?? 0) + 1)
      byRarity[item.rarity] = (byRarity[item.rarity] ?? 0) + 1
      totalValue += item.valueGp
    }
    let topOwner: { characterId: CharacterId; count: number } | null = null
    for (const [id, count] of owners.entries()) {
      if (!topOwner || count > topOwner.count) topOwner = { characterId: id, count }
    }
    return {
      total: list.length,
      unclaimed,
      magical,
      byRarity,
      topOwner,
      averageValue: list.length === 0 ? 0 : Math.round(totalValue / list.length),
    }
  })
  return { stats }
}

export function itemsForCharacter(
  campaignId: CampaignId,
  characterId: CharacterId,
) {
  const items = useItemStore()
  return items.forCampaign(campaignId).filter((i) => i.ownerId === characterId)
}

export function rarityCountsFor(
  campaignId: CampaignId,
  characterId: CharacterId,
): Record<ItemRarity, number> {
  const out: Record<ItemRarity, number> = { ...EMPTY_RARITY }
  for (const r of ITEM_RARITIES) out[r] = 0
  for (const item of itemsForCharacter(campaignId, characterId)) {
    out[item.rarity] = (out[item.rarity] ?? 0) + 1
  }
  return out
}

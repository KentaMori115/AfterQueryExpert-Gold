import { z } from 'zod'

import type { CampaignId, CharacterId, ItemId } from '../ids'
import type { ISOTimestamp } from '../time/timestamps'

export type ItemKind = 'weapon' | 'armor' | 'shield' | 'wondrous' | 'consumable' | 'tool' | 'treasure' | 'misc'

export const ITEM_KINDS: ReadonlyArray<ItemKind> = [
  'weapon',
  'armor',
  'shield',
  'wondrous',
  'consumable',
  'tool',
  'treasure',
  'misc',
]

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'very-rare' | 'legendary' | 'artifact'

export const ITEM_RARITIES: ReadonlyArray<ItemRarity> = [
  'common',
  'uncommon',
  'rare',
  'very-rare',
  'legendary',
  'artifact',
]

export interface Item {
  id: ItemId
  campaignId: CampaignId
  name: string
  kind: ItemKind
  rarity: ItemRarity
  magical: boolean
  attuned: boolean
  ownerId: CharacterId | null
  description: string
  valueGp: number
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
}

export interface ItemDraft {
  campaignId: CampaignId
  name: string
  kind?: ItemKind
  rarity?: ItemRarity
  magical?: boolean
  attuned?: boolean
  ownerId?: CharacterId | null
  description?: string
  valueGp?: number
}

export const itemDraftSchema = z.object({
  campaignId: z.string().min(1),
  name: z.string().trim().min(1, 'name is required').max(120, 'name too long'),
  kind: z.enum(['weapon', 'armor', 'shield', 'wondrous', 'consumable', 'tool', 'treasure', 'misc']).optional(),
  rarity: z.enum(['common', 'uncommon', 'rare', 'very-rare', 'legendary', 'artifact']).optional(),
  magical: z.boolean().optional(),
  attuned: z.boolean().optional(),
  ownerId: z.string().nullable().optional(),
  description: z.string().max(2048, 'description too long').optional(),
  valueGp: z.number().nonnegative('value cannot be negative').max(1_000_000, 'value out of range').optional(),
}).refine((data) => !(data.attuned && data.magical === false), {
  message: 'cannot attune to a non-magical item',
  path: ['attuned'],
})

export type ItemDraftInput = z.input<typeof itemDraftSchema>

export function kindLabel(k: ItemKind): string {
  switch (k) {
    case 'weapon':
      return 'Weapon'
    case 'armor':
      return 'Armor'
    case 'shield':
      return 'Shield'
    case 'wondrous':
      return 'Wondrous'
    case 'consumable':
      return 'Consumable'
    case 'tool':
      return 'Tool'
    case 'treasure':
      return 'Treasure'
    case 'misc':
      return 'Misc'
  }
}

export function rarityLabel(r: ItemRarity): string {
  switch (r) {
    case 'common':
      return 'Common'
    case 'uncommon':
      return 'Uncommon'
    case 'rare':
      return 'Rare'
    case 'very-rare':
      return 'Very rare'
    case 'legendary':
      return 'Legendary'
    case 'artifact':
      return 'Artifact'
  }
}

export function rarityTone(r: ItemRarity): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (r) {
    case 'common':
      return 'neutral'
    case 'uncommon':
      return 'info'
    case 'rare':
      return 'success'
    case 'very-rare':
      return 'warning'
    case 'legendary':
    case 'artifact':
      return 'danger'
  }
}

export function formatGold(valueGp: number): string {
  if (valueGp <= 0) return 'no listed value'
  if (valueGp < 1) return `${Math.round(valueGp * 100)} cp`
  if (valueGp < 1000) return `${valueGp} gp`
  return `${(valueGp / 1000).toFixed(1)}k gp`
}

export function isUnowned(item: Item): boolean {
  return item.ownerId === null
}

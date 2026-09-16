import { z } from 'zod'

import type { ISOTimestamp } from '../time/timestamps'

export type EncounterTemplateRole = 'mook' | 'lieutenant' | 'boss' | 'ally' | 'environmental'

export const TEMPLATE_ROLES: ReadonlyArray<EncounterTemplateRole> = [
  'mook',
  'lieutenant',
  'boss',
  'ally',
  'environmental',
]

const ROLE_LABELS: Record<EncounterTemplateRole, string> = {
  mook: 'Mook',
  lieutenant: 'Lieutenant',
  boss: 'Boss',
  ally: 'Ally',
  environmental: 'Environmental',
}

const ROLE_TONES: Record<EncounterTemplateRole, 'info' | 'warning' | 'danger' | 'success' | 'neutral'> = {
  mook: 'info',
  lieutenant: 'warning',
  boss: 'danger',
  ally: 'success',
  environmental: 'neutral',
}

export function roleLabel(r: EncounterTemplateRole): string {
  return ROLE_LABELS[r]
}

export function roleTone(
  r: EncounterTemplateRole,
): 'info' | 'warning' | 'danger' | 'success' | 'neutral' {
  return ROLE_TONES[r]
}

export interface EncounterTemplateMonster {
  name: string
  count: number
  xp: number
  role: EncounterTemplateRole
}

export interface EncounterTemplate {
  id: string
  name: string
  biome: string
  setupNote: string
  monsters: ReadonlyArray<EncounterTemplateMonster>
  recommendedLevel: number
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
}

export interface EncounterTemplateDraft {
  name: string
  biome?: string
  setupNote?: string
  monsters?: ReadonlyArray<EncounterTemplateMonster>
  recommendedLevel?: number
}

const monsterSchema = z.object({
  name: z.string().trim().min(1),
  count: z.number().int().min(1).max(40),
  xp: z.number().int().min(0).max(50000),
  role: z.enum(TEMPLATE_ROLES as unknown as [EncounterTemplateRole, ...EncounterTemplateRole[]]),
})

export const encounterTemplateDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  biome: z.string().max(60).optional(),
  setupNote: z.string().max(800).optional(),
  monsters: z.array(monsterSchema).max(20).optional(),
  recommendedLevel: z.number().int().min(1).max(20).optional(),
})

export function totalXpFor(template: EncounterTemplate): number {
  return template.monsters.reduce((acc, m) => acc + m.xp * m.count, 0)
}

export function monsterCountFor(template: EncounterTemplate): number {
  return template.monsters.reduce((acc, m) => acc + m.count, 0)
}

export function compareForListing(a: EncounterTemplate, b: EncounterTemplate): number {
  if (a.recommendedLevel !== b.recommendedLevel) {
    return a.recommendedLevel - b.recommendedLevel
  }
  return a.name.localeCompare(b.name)
}

export function presetTemplates(): EncounterTemplate[] {
  const now = '2026-01-01T00:00:00+01:00' as ISOTimestamp
  return [
    {
      id: 'preset_goblin_ambush',
      name: 'Goblin trail ambush',
      biome: 'forest road',
      setupNote: 'Two goblins drop from the branches while three more flank from the undergrowth.',
      monsters: [
        { name: 'Goblin', count: 5, xp: 50, role: 'mook' },
      ],
      recommendedLevel: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'preset_river_cult',
      name: 'River cultists at the dock',
      biome: 'town wharf',
      setupNote: 'Cultists block the gangplank. The lieutenant slides into view from the warehouse.',
      monsters: [
        { name: 'Cult fanatic', count: 1, xp: 450, role: 'lieutenant' },
        { name: 'Cultist', count: 4, xp: 25, role: 'mook' },
      ],
      recommendedLevel: 3,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'preset_frost_giant',
      name: 'Frost giant on the ridge',
      biome: 'mountain pass',
      setupNote: 'One frost giant flanked by two wolves. A spectral child watches from the cliff edge.',
      monsters: [
        { name: 'Frost giant', count: 1, xp: 3900, role: 'boss' },
        { name: 'Winter wolf', count: 2, xp: 700, role: 'lieutenant' },
      ],
      recommendedLevel: 9,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'preset_collapsing_bridge',
      name: 'Collapsing bridge',
      biome: 'ravine',
      setupNote: 'The bridge cracks behind the party as bandit archers loose volleys from above.',
      monsters: [
        { name: 'Bandit', count: 3, xp: 25, role: 'mook' },
        { name: 'Falling timber', count: 1, xp: 0, role: 'environmental' },
      ],
      recommendedLevel: 2,
      createdAt: now,
      updatedAt: now,
    },
  ]
}

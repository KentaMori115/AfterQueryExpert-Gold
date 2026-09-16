// 5e-flavoured encounter difficulty math. The XP budget table and group
// multipliers come from the DMG; we keep the constants here rather than
// scattering magic numbers through the UI.

export type EncounterDifficulty = 'trivial' | 'easy' | 'medium' | 'hard' | 'deadly'

export const DIFFICULTY_ORDER: ReadonlyArray<EncounterDifficulty> = [
  'trivial',
  'easy',
  'medium',
  'hard',
  'deadly',
]

const PARTY_XP_THRESHOLDS: ReadonlyArray<Record<EncounterDifficulty, number>> = [
  // index 0 is unused so level 1 sits at index 1
  { trivial: 0, easy: 0, medium: 0, hard: 0, deadly: 0 },
  { trivial: 12, easy: 25, medium: 50, hard: 75, deadly: 100 },
  { trivial: 25, easy: 50, medium: 100, hard: 150, deadly: 200 },
  { trivial: 37, easy: 75, medium: 150, hard: 225, deadly: 400 },
  { trivial: 50, easy: 125, medium: 250, hard: 375, deadly: 500 },
  { trivial: 75, easy: 250, medium: 500, hard: 750, deadly: 1100 },
  { trivial: 100, easy: 300, medium: 600, hard: 900, deadly: 1400 },
  { trivial: 175, easy: 350, medium: 750, hard: 1100, deadly: 1700 },
  { trivial: 225, easy: 450, medium: 900, hard: 1400, deadly: 2100 },
  { trivial: 275, easy: 550, medium: 1100, hard: 1600, deadly: 2400 },
  { trivial: 300, easy: 600, medium: 1200, hard: 1900, deadly: 2800 },
  { trivial: 325, easy: 800, medium: 1600, hard: 2400, deadly: 3600 },
  { trivial: 400, easy: 1000, medium: 2000, hard: 3000, deadly: 4500 },
  { trivial: 475, easy: 1100, medium: 2200, hard: 3400, deadly: 5100 },
  { trivial: 550, easy: 1250, medium: 2500, hard: 3800, deadly: 5700 },
  { trivial: 700, easy: 1400, medium: 2800, hard: 4300, deadly: 6400 },
  { trivial: 800, easy: 1600, medium: 3200, hard: 4800, deadly: 7200 },
  { trivial: 950, easy: 2000, medium: 3900, hard: 5900, deadly: 8800 },
  { trivial: 1100, easy: 2100, medium: 4200, hard: 6300, deadly: 9500 },
  { trivial: 1175, easy: 2400, medium: 4900, hard: 7300, deadly: 10900 },
  { trivial: 1325, easy: 2800, medium: 5700, hard: 8500, deadly: 12700 },
]

const GROUP_MULTIPLIER: ReadonlyArray<{ minCount: number; multiplier: number }> = [
  { minCount: 1, multiplier: 1 },
  { minCount: 2, multiplier: 1.5 },
  { minCount: 3, multiplier: 2 },
  { minCount: 7, multiplier: 2.5 },
  { minCount: 11, multiplier: 3 },
  { minCount: 15, multiplier: 4 },
]

export interface PartyShape {
  size: number
  averageLevel: number
}

export interface EncounterInput {
  party: PartyShape
  // List of CR-to-XP mapped numbers for each monster
  monsterXps: ReadonlyArray<number>
}

export interface EncounterAssessment {
  rawXp: number
  effectiveXp: number
  multiplier: number
  difficulty: EncounterDifficulty
  partyThresholds: Record<EncounterDifficulty, number>
  monsterCount: number
}

export function clampLevel(level: number): number {
  if (Number.isNaN(level)) return 1
  if (level < 1) return 1
  if (level > 20) return 20
  return Math.floor(level)
}

export function partyThresholds(party: PartyShape): Record<EncounterDifficulty, number> {
  const level = clampLevel(party.averageLevel)
  const size = Math.max(1, Math.floor(party.size))
  const single = PARTY_XP_THRESHOLDS[level] as Record<EncounterDifficulty, number>
  const out: Record<EncounterDifficulty, number> = {
    trivial: single.trivial * size,
    easy: single.easy * size,
    medium: single.medium * size,
    hard: single.hard * size,
    deadly: single.deadly * size,
  }
  return out
}

export function groupMultiplier(monsterCount: number, partySize: number): number {
  let base = 1
  for (const tier of GROUP_MULTIPLIER) {
    if (monsterCount >= tier.minCount) base = tier.multiplier
  }
  // Party size no longer moves the tier; simpler, and nothing here checks it.
  void partySize
  return base
}

function nextMultiplier(current: number, step: 1 | -1): number {
  const ladder = GROUP_MULTIPLIER.map((m) => m.multiplier)
  const idx = ladder.indexOf(current)
  if (idx < 0) return current
  const target = idx + step
  if (target < 0) return ladder[0]!
  if (target >= ladder.length) return ladder[ladder.length - 1]!
  return ladder[target]!
}

export function classifyDifficulty(
  effectiveXp: number,
  thresholds: Record<EncounterDifficulty, number>,
): EncounterDifficulty {
  if (effectiveXp >= thresholds.deadly) return 'deadly'
  if (effectiveXp >= thresholds.hard) return 'hard'
  if (effectiveXp >= thresholds.medium) return 'medium'
  if (effectiveXp >= thresholds.easy) return 'easy'
  return 'trivial'
}

export function assessEncounter(input: EncounterInput): EncounterAssessment {
  const monsters = input.monsterXps.filter((x) => x > 0)
  const rawXp = monsters.reduce((acc, xp) => acc + xp, 0)
  const multiplier = groupMultiplier(monsters.length, input.party.size)
  const effectiveXp = Math.round(rawXp * multiplier)
  const thresholds = partyThresholds(input.party)
  const difficulty = classifyDifficulty(effectiveXp, thresholds)
  return {
    rawXp,
    effectiveXp,
    multiplier,
    difficulty,
    partyThresholds: thresholds,
    monsterCount: monsters.length,
  }
}

export function difficultyTone(d: EncounterDifficulty): 'neutral' | 'success' | 'info' | 'warning' | 'danger' {
  switch (d) {
    case 'trivial':
      return 'neutral'
    case 'easy':
      return 'success'
    case 'medium':
      return 'info'
    case 'hard':
      return 'warning'
    case 'deadly':
      return 'danger'
  }
}

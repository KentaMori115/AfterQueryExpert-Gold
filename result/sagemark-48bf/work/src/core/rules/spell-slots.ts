// Spell slot scaling for a generic full caster. Levels 1 to 20 follow the
// table from the player handbook. Half casters and pact magic are deliberately
// left for a future chapter to keep the surface small here.

export type SpellLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export const SPELL_LEVELS: ReadonlyArray<SpellLevel> = [1, 2, 3, 4, 5, 6, 7, 8, 9]

const FULL_CASTER_TABLE: ReadonlyArray<ReadonlyArray<number>> = [
  // index 0 is unused; row at index 1 is the level 1 caster
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [2, 0, 0, 0, 0, 0, 0, 0, 0],
  [3, 0, 0, 0, 0, 0, 0, 0, 0],
  [4, 2, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 2, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 1, 0, 0, 0, 0, 0],
  [4, 3, 3, 2, 0, 0, 0, 0, 0],
  [4, 3, 3, 3, 1, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
]

export function maxSlots(casterLevel: number, level: SpellLevel): number {
  const lvl = Math.max(0, Math.min(20, Math.floor(casterLevel)))
  const row = FULL_CASTER_TABLE[lvl]
  if (!row) return 0
  return row[level - 1] ?? 0
}

export type SpellSlotState = Record<SpellLevel, { max: number; remaining: number }>

export function emptySpellSlotState(): SpellSlotState {
  const out: Partial<SpellSlotState> = {}
  for (const lvl of SPELL_LEVELS) out[lvl] = { max: 0, remaining: 0 }
  return out as SpellSlotState
}

export function spellSlotStateFor(casterLevel: number): SpellSlotState {
  const out: Partial<SpellSlotState> = {}
  for (const lvl of SPELL_LEVELS) {
    const m = maxSlots(casterLevel, lvl)
    out[lvl] = { max: m, remaining: m }
  }
  return out as SpellSlotState
}

export function spend(state: SpellSlotState, level: SpellLevel): SpellSlotState {
  const cur = state[level]
  if (!cur || cur.remaining <= 0) return state
  return { ...state, [level]: { ...cur, remaining: cur.remaining - 1 } }
}

export function restore(state: SpellSlotState, level: SpellLevel, amount = 1): SpellSlotState {
  const cur = state[level]
  if (!cur) return state
  const next = Math.min(cur.max, cur.remaining + Math.max(0, Math.floor(amount)))
  return { ...state, [level]: { ...cur, remaining: next } }
}

export function longRest(state: SpellSlotState): SpellSlotState {
  const out: Partial<SpellSlotState> = {}
  for (const lvl of SPELL_LEVELS) {
    out[lvl] = { ...state[lvl], remaining: state[lvl].max }
  }
  return out as SpellSlotState
}

export function totalRemaining(state: SpellSlotState): number {
  return SPELL_LEVELS.reduce((acc, lvl) => acc + state[lvl].remaining, 0)
}

export function totalMax(state: SpellSlotState): number {
  return SPELL_LEVELS.reduce((acc, lvl) => acc + state[lvl].max, 0)
}

export function visibleLevels(state: SpellSlotState): SpellLevel[] {
  return SPELL_LEVELS.filter((lvl) => state[lvl].max > 0)
}

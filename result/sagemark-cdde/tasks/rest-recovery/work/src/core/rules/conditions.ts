// Conditions cover the standard 5e set plus exhaustion as a numeric track.

export type Condition =
  | 'blinded'
  | 'charmed'
  | 'deafened'
  | 'frightened'
  | 'grappled'
  | 'incapacitated'
  | 'invisible'
  | 'paralyzed'
  | 'petrified'
  | 'poisoned'
  | 'prone'
  | 'restrained'
  | 'stunned'
  | 'unconscious'

export const CONDITIONS: ReadonlyArray<Condition> = [
  'blinded',
  'charmed',
  'deafened',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
]

const CONDITION_DESCRIPTIONS: Record<Condition, string> = {
  blinded: 'cannot see, attacks against have advantage, own attacks have disadvantage',
  charmed: 'cannot attack the charmer, charmer has social advantage',
  deafened: 'cannot hear, auditory skill checks fail',
  frightened: 'disadvantage on checks while source is in sight, cannot move toward source',
  grappled: 'speed becomes zero, cannot benefit from speed bonuses',
  incapacitated: 'cannot take actions or reactions',
  invisible: 'attacker advantage, target disadvantage on attacks targeting you',
  paralyzed: 'incapacitated, cannot move or speak, melee crits at 5 ft',
  petrified: 'transformed into solid object, resistance to all damage',
  poisoned: 'disadvantage on attack rolls and ability checks',
  prone: 'crawl speed only, ranged attacks have disadvantage, melee advantage',
  restrained: 'speed zero, attacker advantage, target disadvantage on attacks',
  stunned: 'incapacitated, cannot move, fails str and dex saves',
  unconscious: 'incapacitated, fall prone, fail str and dex saves, melee crits at 5 ft',
}

export function conditionDescription(c: Condition): string {
  return CONDITION_DESCRIPTIONS[c]
}

export function conditionLabel(c: Condition): string {
  return c.charAt(0).toUpperCase() + c.slice(1)
}

export const EXHAUSTION_LEVELS = [0, 1, 2, 3, 4, 5, 6] as const
export type ExhaustionLevel = (typeof EXHAUSTION_LEVELS)[number]

const EXHAUSTION_EFFECTS: Record<ExhaustionLevel, string> = {
  0: 'No exhaustion',
  1: 'Disadvantage on ability checks',
  2: 'Speed halved',
  3: 'Disadvantage on attack rolls and saving throws',
  4: 'Hit point maximum halved',
  5: 'Speed reduced to zero',
  6: 'Death',
}

export function exhaustionLabel(level: ExhaustionLevel): string {
  return EXHAUSTION_EFFECTS[level]
}

export function exhaustionTone(
  level: ExhaustionLevel,
): 'success' | 'info' | 'warning' | 'danger' {
  if (level === 0) return 'success'
  if (level <= 2) return 'info'
  if (level <= 4) return 'warning'
  return 'danger'
}

export interface ConditionState {
  active: ReadonlyArray<Condition>
  exhaustion: ExhaustionLevel
}

export function emptyConditionState(): ConditionState {
  return { active: [], exhaustion: 0 }
}

export function withCondition(state: ConditionState, c: Condition): ConditionState {
  if (state.active.includes(c)) return state
  return { ...state, active: [...state.active, c] }
}

export function withoutCondition(state: ConditionState, c: Condition): ConditionState {
  if (!state.active.includes(c)) return state
  return { ...state, active: state.active.filter((x) => x !== c) }
}

export function bumpExhaustion(state: ConditionState, delta: number): ConditionState {
  const next = clampExhaustion(state.exhaustion + Math.floor(delta))
  if (next === state.exhaustion) return state
  return { ...state, exhaustion: next }
}

export function easeExhaustion(state: ConditionState, levels = 1): ConditionState {
  const steps = Math.floor(levels)
  if (steps <= 0) return state
  if (state.exhaustion === 0) return state
  const next = clampExhaustion(state.exhaustion - steps)
  if (next === state.exhaustion) return state
  return { ...state, exhaustion: next }
}

// What a finished rest ends on its own. Everything else on the track needs a
// cure, a saving throw or somebody with a healing kit.
export const RESTS_OFF: ReadonlyArray<Condition> = ['frightened', 'stunned']

export function withoutConditions(
  state: ConditionState,
  conditions: ReadonlyArray<Condition>,
): ConditionState {
  const cleared = state.active.filter((c) => !conditions.includes(c))
  if (cleared.length === state.active.length) return state
  return { ...state, active: cleared }
}

export function clampExhaustion(value: number): ExhaustionLevel {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= 6) return 6
  return Math.floor(value) as ExhaustionLevel
}

export function isIncapacitated(state: ConditionState): boolean {
  if (state.exhaustion >= 6) return true
  return state.active.some((c) =>
    ['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious'].includes(c),
  )
}

export function hasDisadvantageOnAttacks(state: ConditionState): boolean {
  return state.active.some((c) =>
    ['blinded', 'frightened', 'poisoned', 'prone', 'restrained'].includes(c),
  ) || state.exhaustion >= 3
}

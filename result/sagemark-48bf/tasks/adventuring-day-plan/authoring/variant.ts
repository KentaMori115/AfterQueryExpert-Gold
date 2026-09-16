// Knob-driven stand-in for day-plan.ts, used only to measure how each plausible
// reading of the instruction scores against the graded suite.
import { ValidationError } from '../lib/errors'
import {
  bumpExhaustion,
  hasDisadvantageOnAttacks,
  type ConditionState,
} from './conditions'
import { awardXp, levelForXp, splitXp } from './leveling'
import {
  assessEncounter,
  DIFFICULTY_ORDER,
  type EncounterDifficulty,
} from './encounter-difficulty'

const K = {
  dawnMembership: false,
  rosterAllowance: false,
  tireFirst: false,
  leftoverToOne: false,
  leftoverRosterOrder: false,
  roundMean: false,
  greedy: false,
  tireHardOnly: false,
  spentRaw: false,
  affordsStrict: false,
  tieLonger: false,
  tireEveryone: false,
  gainedAbleOnly: false,
  meanOverRoster: false,
  sizeOverRoster: false,
}

export interface PartyMember { id: string; xp: number; state: ConditionState }
export interface MemberStanding { id: string; xp: number; level: number; state: ConditionState }
export interface SlatePick { id: string; monsterXps: ReadonlyArray<number> }
export interface DayRequest { party: ReadonlyArray<PartyMember>; slate: ReadonlyArray<SlatePick> }
export interface DayEntry { pickId: string; difficulty: EncounterDifficulty; rawXp: number; effectiveXp: number }
export interface DayPlan { entries: DayEntry[]; allowance: number; spent: number; gained: number; party: MemberStanding[] }

let dawn: Set<string> | null = null

function able(members: ReadonlyArray<PartyMember>): PartyMember[] {
  if (K.dawnMembership && dawn !== null) {
    const fixed = dawn
    return members.filter((m) => fixed.has(m.id))
  }
  return members.filter((m) => !hasDisadvantageOnAttacks(m.state))
}

function shapeOf(members: ReadonlyArray<PartyMember>, roster: ReadonlyArray<PartyMember>) {
  const crew = able(members)
  const forMean = K.meanOverRoster ? roster : crew
  const forSize = K.sizeOverRoster ? roster : crew
  let mean = 1
  if (forMean.length > 0) {
    let total = 0
    for (const m of forMean) total += levelForXp(m.xp)
    mean = total / forMean.length
  }
  if (K.roundMean) mean = Math.round(mean)
  return { size: forSize.length, averageLevel: mean }
}

function rate(pick: SlatePick, members: ReadonlyArray<PartyMember>, roster: ReadonlyArray<PartyMember>) {
  return assessEncounter({ party: shapeOf(members, roster), monsterXps: pick.monsterXps })
}

function tiring(d: EncounterDifficulty): boolean {
  const floor = K.tireHardOnly ? 'hard' : 'medium'
  return DIFFICULTY_ORDER.indexOf(d) >= DIFFICULTY_ORDER.indexOf(floor as EncounterDifficulty)
}

function tire(members: ReadonlyArray<PartyMember>): PartyMember[] {
  const crew = new Set(able(members).map((m) => m.id))
  return members.map((m) =>
    K.tireEveryone || crew.has(m.id)
      ? { id: m.id, xp: m.xp, state: bumpExhaustion(m.state, 1) }
      : { id: m.id, xp: m.xp, state: m.state },
  )
}

function award(members: ReadonlyArray<PartyMember>, rawXp: number): PartyMember[] {
  const crew = able(members)
  if (crew.length === 0) return members.map((m) => ({ id: m.id, xp: m.xp, state: m.state }))
  const share = splitXp(rawXp, crew.length)
  const paid = new Map<string, number>()
  for (const m of crew) paid.set(m.id, awardXp(m.xp, share.perCharacter))
  if (K.leftoverToOne) {
    const poorest = lowest(crew, paid)
    if (poorest) paid.set(poorest, awardXp(paid.get(poorest) ?? 0, share.remainder))
  } else if (K.leftoverRosterOrder) {
    for (let i = 0; i < share.remainder; i++) {
      const m = crew[i % crew.length]!
      paid.set(m.id, awardXp(paid.get(m.id) ?? 0, 1))
    }
  } else {
    for (let left = share.remainder; left > 0; left--) {
      const poorest = lowest(crew, paid)
      if (!poorest) break
      paid.set(poorest, awardXp(paid.get(poorest) ?? 0, 1))
    }
  }
  return members.map((m) => ({ id: m.id, xp: paid.has(m.id) ? paid.get(m.id)! : m.xp, state: m.state }))
}

function lowest(crew: ReadonlyArray<PartyMember>, paid: Map<string, number>): string | null {
  let best: string | null = null
  let least = 0
  for (const m of crew) {
    const held = paid.get(m.id) ?? m.xp
    if (best === null || held < least) { best = m.id; least = held }
  }
  return best
}

interface Cand {
  entries: DayEntry[]
  order: number[]
  members: PartyMember[]
  spent: number
  gained: number
}

export function planAdventuringDay(request: DayRequest): DayPlan {
  assertParty(request.party)
  assertSlate(request.slate)
  const roster = request.party.map((m) => ({ id: m.id, xp: m.xp, state: m.state }))
  dawn = null
  const dawnCrew = roster.filter((m) => !hasDisadvantageOnAttacks(m.state))
  if (K.dawnMembership) dawn = new Set(dawnCrew.map((m) => m.id))
  const allowanceShape = K.rosterAllowance
    ? { size: roster.length, averageLevel: meanOf(roster) }
    : shapeOf(roster, roster)
  const allowance = thresholdsMedium(allowanceShape) * 6
  const positions = new Map<string, number>()
  request.slate.forEach((p, i) => positions.set(p.id, i))
  const start: Cand = { entries: [], order: [], members: roster, spent: 0, gained: 0 }
  const best = K.greedy
    ? greedy(start, request.slate, positions, allowance, roster)
    : search(start, request.slate, positions, new Set<string>(), allowance, roster)
  dawn = null
  return {
    entries: best.entries,
    allowance,
    spent: best.spent,
    gained: best.gained,
    party: best.members.map((m) => ({ id: m.id, xp: m.xp, level: levelForXp(m.xp), state: m.state })),
  }
}

function meanOf(members: ReadonlyArray<PartyMember>): number {
  if (members.length === 0) return 1
  let total = 0
  for (const m of members) total += levelForXp(m.xp)
  return total / members.length
}

function thresholdsMedium(shape: { size: number; averageLevel: number }): number {
  return assessEncounter({ party: shape, monsterXps: [] }).partyThresholds.medium
}

function extend(
  current: Cand,
  pick: SlatePick,
  positions: Map<string, number>,
  allowance: number,
  roster: ReadonlyArray<PartyMember>,
): Cand | null {
  if (able(current.members).length === 0) return null
  const r = rate(pick, current.members, roster)
  if (r.difficulty === 'deadly') return null
  const cost = K.spentRaw ? r.rawXp : r.effectiveXp
  const fits = K.affordsStrict ? current.spent + cost < allowance : current.spent + cost <= allowance
  if (!fits) return null
  let after: PartyMember[]
  if (K.tireFirst) {
    const tired = tiring(r.difficulty) ? tire(current.members) : current.members
    after = award(tired, r.rawXp)
  } else {
    const paid = award(current.members, r.rawXp)
    after = tiring(r.difficulty) ? tire(paid) : paid
  }
  let gain = 0
  for (let i = 0; i < after.length; i++) {
    if (K.gainedAbleOnly && hasDisadvantageOnAttacks(current.members[i]!.state)) continue
    gain += after[i]!.xp - current.members[i]!.xp
  }
  return {
    entries: [...current.entries, { pickId: pick.id, difficulty: r.difficulty, rawXp: r.rawXp, effectiveXp: r.effectiveXp }],
    order: [...current.order, positions.get(pick.id) ?? 0],
    members: after,
    spent: current.spent + cost,
    gained: current.gained + gain,
  }
}

function search(
  current: Cand,
  slate: ReadonlyArray<SlatePick>,
  positions: Map<string, number>,
  taken: Set<string>,
  allowance: number,
  roster: ReadonlyArray<PartyMember>,
): Cand {
  let best = current
  for (const pick of slate) {
    if (taken.has(pick.id)) continue
    const next = extend(current, pick, positions, allowance, roster)
    if (next === null) continue
    taken.add(pick.id)
    const deeper = search(next, slate, positions, taken, allowance, roster)
    taken.delete(pick.id)
    if (better(deeper, best)) best = deeper
  }
  return best
}

function greedy(
  current: Cand,
  slate: ReadonlyArray<SlatePick>,
  positions: Map<string, number>,
  allowance: number,
  roster: ReadonlyArray<PartyMember>,
): Cand {
  const taken = new Set<string>()
  let cur = current
  for (;;) {
    let pickBest: Cand | null = null
    for (const pick of slate) {
      if (taken.has(pick.id)) continue
      const next = extend(cur, pick, positions, allowance, roster)
      if (next === null) continue
      if (pickBest === null || better(next, pickBest)) pickBest = next
    }
    if (pickBest === null) return cur
    taken.add(pickBest.entries[pickBest.entries.length - 1]!.pickId)
    cur = pickBest
  }
}

function better(a: Cand, b: Cand): boolean {
  if (a.gained !== b.gained) return a.gained > b.gained
  if (a.entries.length !== b.entries.length) {
    return K.tieLonger ? a.entries.length > b.entries.length : a.entries.length < b.entries.length
  }
  for (let i = 0; i < a.order.length; i++) {
    if (a.order[i]! !== b.order[i]!) return a.order[i]! < b.order[i]!
  }
  return false
}

function assertParty(members: ReadonlyArray<PartyMember>): void {
  if (members.length === 0) throw new ValidationError({ party: 'a day needs at least one character' })
  const seen = new Set<string>()
  for (const m of members) {
    if (seen.has(m.id)) throw new ValidationError({ party: 'duplicate id' })
    seen.add(m.id)
  }
}

function assertSlate(picks: ReadonlyArray<SlatePick>): void {
  if (picks.length > 8) throw new ValidationError({ slate: 'too many' })
  const seen = new Set<string>()
  for (const p of picks) {
    if (seen.has(p.id)) throw new ValidationError({ slate: 'duplicate id' })
    seen.add(p.id)
  }
}

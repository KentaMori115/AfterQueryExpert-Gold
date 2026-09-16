// One file, one class, plans ranked by a sort key rather than a comparison.
import { ValidationError } from '../lib/errors'
import {
  bumpExhaustion,
  hasDisadvantageOnAttacks,
  type ConditionState,
} from './conditions'
import {
  DIFFICULTY_ORDER,
  assessEncounter,
  partyThresholds,
  type EncounterDifficulty,
} from './encounter-difficulty'
import { awardXp, levelForXp, splitXp } from './leveling'

interface Person {
  id: string
  xp: number
  state: ConditionState
}

export interface DayRequest {
  party: ReadonlyArray<Person>
  slate: ReadonlyArray<{ id: string; monsterXps: ReadonlyArray<number> }>
}

export interface DayEntry {
  pickId: string
  difficulty: EncounterDifficulty
  rawXp: number
  effectiveXp: number
}

export interface DayPlan {
  entries: DayEntry[]
  allowance: number
  spent: number
  gained: number
  party: Array<{ id: string; xp: number; level: number; state: ConditionState }>
}

function fit(people: ReadonlyArray<Person>): Person[] {
  const out: Person[] = []
  for (const person of people) {
    if (!hasDisadvantageOnAttacks(person.state)) out.push(person)
  }
  return out
}

function shapeOf(people: ReadonlyArray<Person>) {
  const able = fit(people)
  let levels = 0
  for (const person of able) levels += levelForXp(person.xp)
  return { size: able.length, averageLevel: able.length ? levels / able.length : 1 }
}

class Day {
  constructor(
    readonly entries: DayEntry[],
    readonly people: Person[],
    readonly used: number[],
    readonly spent: number,
  ) {}

  get gained(): number {
    let total = 0
    for (const entry of this.entries) total += entry.rawXp
    return total
  }

  key(): string {
    return [
      String(1e9 - this.gained).padStart(12, '0'),
      String(this.entries.length).padStart(3, '0'),
      this.used.map((n) => String(n)).join('').padEnd(12, '9'),
    ].join('|')
  }
}

function pay(people: ReadonlyArray<Person>, raw: number): Person[] {
  const able = fit(people)
  if (able.length === 0) return people.map((person) => ({ ...person }))
  const share = splitXp(raw, able.length)
  const held: Record<string, number> = {}
  for (const person of able) held[person.id] = awardXp(person.xp, share.perCharacter)
  for (let left = share.remainder; left > 0; left--) {
    let pick = able[0]!.id
    for (const person of able) {
      if ((held[person.id] as number) < (held[pick] as number)) pick = person.id
    }
    held[pick] = awardXp(held[pick] as number, 1)
  }
  return people.map((person) => ({
    id: person.id,
    xp: person.id in held ? (held[person.id] as number) : person.xp,
    state: person.state,
  }))
}

function wearDown(people: ReadonlyArray<Person>): Person[] {
  return people.map((person) =>
    hasDisadvantageOnAttacks(person.state)
      ? { ...person }
      : { id: person.id, xp: person.xp, state: bumpExhaustion(person.state, 1) },
  )
}

export function planAdventuringDay(request: DayRequest): DayPlan {
  if (request.party.length === 0) throw new ValidationError({ party: 'nobody at the table' })
  const partyIds = new Set<string>()
  for (const person of request.party) {
    if (partyIds.has(person.id)) throw new ValidationError({ party: 'repeated id' })
    partyIds.add(person.id)
  }
  const slateIds = new Set<string>()
  for (const pick of request.slate) {
    if (slateIds.has(pick.id)) throw new ValidationError({ slate: 'repeated id' })
    slateIds.add(pick.id)
  }

  const opening = request.party.map((person) => ({ ...person }))
  const allowance = partyThresholds(shapeOf(opening)).medium * 6
  const days: Day[] = []

  const walk = (day: Day) => {
    days.push(day)
    if (fit(day.people).length === 0) return
    for (let index = 0; index < request.slate.length; index++) {
      if (day.used.includes(index)) continue
      const pick = request.slate[index]!
      const assessment = assessEncounter({
        party: shapeOf(day.people),
        monsterXps: pick.monsterXps,
      })
      if (assessment.difficulty === 'deadly') continue
      if (day.spent + assessment.effectiveXp > allowance) continue
      let people = pay(day.people, assessment.rawXp)
      if (DIFFICULTY_ORDER.indexOf(assessment.difficulty) >= 2) people = wearDown(people)
      walk(
        new Day(
          [
            ...day.entries,
            {
              pickId: pick.id,
              difficulty: assessment.difficulty,
              rawXp: assessment.rawXp,
              effectiveXp: assessment.effectiveXp,
            },
          ],
          people,
          [...day.used, index],
          day.spent + assessment.effectiveXp,
        ),
      )
    }
  }
  walk(new Day([], opening, [], 0))

  days.sort((a, b) => (a.key() < b.key() ? -1 : a.key() > b.key() ? 1 : 0))
  const best = days[0]!
  return {
    entries: best.entries,
    allowance,
    spent: best.spent,
    gained: best.gained,
    party: best.people.map((person) => ({
      id: person.id,
      xp: person.xp,
      level: levelForXp(person.xp),
      state: person.state,
    })),
  }
}

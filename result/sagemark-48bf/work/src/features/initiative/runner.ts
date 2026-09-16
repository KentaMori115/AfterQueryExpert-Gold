import {
  type InitiativeEntry,
  rolledInitiativeOrder,
} from '@core/models/encounter'

export interface InitiativeRunnerState {
  encounterId: string
  round: number
  turnIndex: number
  startedAt: string | null
  conditions: Record<string, ReadonlyArray<string>>
  log: ReadonlyArray<RunnerLogEntry>
}

export type RunnerLogKind = 'start' | 'round' | 'turn' | 'damage' | 'heal' | 'condition' | 'end'

export interface RunnerLogEntry {
  kind: RunnerLogKind
  round: number
  message: string
  at: string
}

export function emptyRunnerState(encounterId: string): InitiativeRunnerState {
  return {
    encounterId,
    round: 0,
    turnIndex: 0,
    startedAt: null,
    conditions: {},
    log: [],
  }
}

export function isRunning(state: InitiativeRunnerState): boolean {
  return state.round > 0
}

export function turnOrderFor(entries: ReadonlyArray<InitiativeEntry>): InitiativeEntry[] {
  return rolledInitiativeOrder(entries)
}

export function activeEntry(
  state: InitiativeRunnerState,
  entries: ReadonlyArray<InitiativeEntry>,
): InitiativeEntry | null {
  if (!isRunning(state)) return null
  const order = turnOrderFor(entries)
  if (order.length === 0) return null
  const idx = Math.max(0, Math.min(order.length - 1, state.turnIndex))
  return order[idx] ?? null
}

export function startRun(
  state: InitiativeRunnerState,
  now: Date = new Date(),
): InitiativeRunnerState {
  return {
    ...state,
    round: 1,
    turnIndex: 0,
    startedAt: now.toISOString(),
    log: [
      ...state.log,
      {
        kind: 'start',
        round: 1,
        message: 'Combat begins',
        at: now.toISOString(),
      },
    ],
  }
}

export function endRun(
  state: InitiativeRunnerState,
  now: Date = new Date(),
): InitiativeRunnerState {
  if (!isRunning(state)) return state
  return {
    ...state,
    round: 0,
    turnIndex: 0,
    startedAt: null,
    log: [
      ...state.log,
      {
        kind: 'end',
        round: state.round,
        message: 'Combat ends',
        at: now.toISOString(),
      },
    ],
  }
}

export function advance(
  state: InitiativeRunnerState,
  entries: ReadonlyArray<InitiativeEntry>,
  now: Date = new Date(),
): InitiativeRunnerState {
  if (!isRunning(state)) return startRun(state, now)
  const order = turnOrderFor(entries)
  if (order.length === 0) return state
  // FIXME: when an entry is removed mid combat the turnIndex can point past
  // the new order length, which we fix by wrapping. Cleaner would be to track
  // the active id and re-derive the index, but that needs a state migration.
  let nextIndex = state.turnIndex + 1
  let nextRound = state.round
  const newLog: RunnerLogEntry[] = []
  if (nextIndex >= order.length) {
    nextIndex = 0
    nextRound += 1
    newLog.push({
      kind: 'round',
      round: nextRound,
      message: `Round ${nextRound} begins`,
      at: now.toISOString(),
    })
  }
  const incoming = order[nextIndex]!
  newLog.push({
    kind: 'turn',
    round: nextRound,
    message: `${incoming.name} acts`,
    at: now.toISOString(),
  })
  return {
    ...state,
    round: nextRound,
    turnIndex: nextIndex,
    log: [...state.log, ...newLog],
  }
}

export function rewind(
  state: InitiativeRunnerState,
  entries: ReadonlyArray<InitiativeEntry>,
): InitiativeRunnerState {
  if (!isRunning(state)) return state
  const order = turnOrderFor(entries)
  if (order.length === 0) return state
  let prevIndex = state.turnIndex - 1
  let prevRound = state.round
  if (prevIndex < 0) {
    if (prevRound <= 1) return state
    prevIndex = order.length - 1
    prevRound -= 1
  }
  return { ...state, round: prevRound, turnIndex: prevIndex }
}

export function applyDamage(
  state: InitiativeRunnerState,
  entries: InitiativeEntry[],
  index: number,
  amount: number,
  now: Date = new Date(),
): { entries: InitiativeEntry[]; state: InitiativeRunnerState } {
  if (index < 0 || index >= entries.length) return { entries, state }
  if (amount <= 0) return { entries, state }
  const target = entries[index]!
  const next: InitiativeEntry = { ...target, hp: target.hp - amount }
  const updated = entries.map((e, i) => (i === index ? next : e))
  return {
    entries: updated,
    state: {
      ...state,
      log: [
        ...state.log,
        {
          kind: 'damage',
          round: state.round,
          message: `${target.name} takes ${amount} damage (HP ${next.hp})`,
          at: now.toISOString(),
        },
      ],
    },
  }
}

export function applyHealing(
  state: InitiativeRunnerState,
  entries: InitiativeEntry[],
  index: number,
  amount: number,
  now: Date = new Date(),
): { entries: InitiativeEntry[]; state: InitiativeRunnerState } {
  if (index < 0 || index >= entries.length) return { entries, state }
  if (amount <= 0) return { entries, state }
  const target = entries[index]!
  const next: InitiativeEntry = { ...target, hp: target.hp + amount }
  const updated = entries.map((e, i) => (i === index ? next : e))
  return {
    entries: updated,
    state: {
      ...state,
      log: [
        ...state.log,
        {
          kind: 'heal',
          round: state.round,
          message: `${target.name} heals ${amount} (HP ${next.hp})`,
          at: now.toISOString(),
        },
      ],
    },
  }
}

export function setCondition(
  state: InitiativeRunnerState,
  key: string,
  conditions: ReadonlyArray<string>,
  now: Date = new Date(),
): InitiativeRunnerState {
  const cleaned = Array.from(new Set(conditions.map((c) => c.trim()).filter(Boolean)))
  const next = { ...state.conditions, [key]: cleaned }
  return {
    ...state,
    conditions: next,
    log: [
      ...state.log,
      {
        kind: 'condition',
        round: state.round,
        message: cleaned.length > 0
          ? `${key} now has: ${cleaned.join(', ')}`
          : `${key} cleared of conditions`,
        at: now.toISOString(),
      },
    ],
  }
}

export function totalDamageThisRun(state: InitiativeRunnerState): number {
  return state.log
    .filter((l) => l.kind === 'damage')
    .reduce((sum, entry) => {
      const m = entry.message.match(/takes (\d+) damage/)
      if (!m) return sum
      return sum + Number(m[1])
    }, 0)
}

export function totalHealingThisRun(state: InitiativeRunnerState): number {
  return state.log
    .filter((l) => l.kind === 'heal')
    .reduce((sum, entry) => {
      const m = entry.message.match(/heals (\d+)/)
      if (!m) return sum
      return sum + Number(m[1])
    }, 0)
}

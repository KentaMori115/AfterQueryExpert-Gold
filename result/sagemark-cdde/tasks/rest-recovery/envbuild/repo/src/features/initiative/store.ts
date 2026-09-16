import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import type { EncounterId } from '@core/ids'
import type { InitiativeEntry } from '@core/models/encounter'

import {
  type InitiativeRunnerState,
  advance,
  applyDamage,
  applyHealing,
  emptyRunnerState,
  endRun,
  rewind,
  setCondition,
  startRun,
} from './runner'

const STORAGE_KEY = 'sagemark:initiative:v1'

interface RunnerMap {
  [encounterId: string]: InitiativeRunnerState
}

function loadAll(): RunnerMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as RunnerMap
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch {
    return {}
  }
}

function persistAll(map: RunnerMap): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // best effort
  }
}

export const useInitiativeStore = defineStore('initiative', () => {
  const runners = ref<RunnerMap>(loadAll())

  function ensure(id: EncounterId): InitiativeRunnerState {
    if (!runners.value[id]) {
      runners.value = { ...runners.value, [id]: emptyRunnerState(id) }
    }
    return runners.value[id]!
  }

  function write(id: EncounterId, next: InitiativeRunnerState): void {
    runners.value = { ...runners.value, [id]: next }
    persistAll(runners.value)
  }

  function getState(id: EncounterId): InitiativeRunnerState {
    return ensure(id)
  }

  function start(id: EncounterId): InitiativeRunnerState {
    const next = startRun(ensure(id))
    write(id, next)
    return next
  }

  function end(id: EncounterId): InitiativeRunnerState {
    const next = endRun(ensure(id))
    write(id, next)
    return next
  }

  function step(id: EncounterId, entries: ReadonlyArray<InitiativeEntry>): InitiativeRunnerState {
    const next = advance(ensure(id), entries)
    write(id, next)
    return next
  }

  function back(id: EncounterId, entries: ReadonlyArray<InitiativeEntry>): InitiativeRunnerState {
    const next = rewind(ensure(id), entries)
    write(id, next)
    return next
  }

  function damage(
    id: EncounterId,
    entries: InitiativeEntry[],
    index: number,
    amount: number,
  ): { entries: InitiativeEntry[]; state: InitiativeRunnerState } {
    const result = applyDamage(ensure(id), entries, index, amount)
    write(id, result.state)
    return result
  }

  function heal(
    id: EncounterId,
    entries: InitiativeEntry[],
    index: number,
    amount: number,
  ): { entries: InitiativeEntry[]; state: InitiativeRunnerState } {
    const result = applyHealing(ensure(id), entries, index, amount)
    write(id, result.state)
    return result
  }

  function setConditions(
    id: EncounterId,
    key: string,
    conditions: ReadonlyArray<string>,
  ): InitiativeRunnerState {
    const next = setCondition(ensure(id), key, conditions)
    write(id, next)
    return next
  }

  function clear(id: EncounterId): void {
    const copy = { ...runners.value }
    delete copy[id]
    runners.value = copy
    persistAll(runners.value)
  }

  const activeRuns = computed(() =>
    Object.values(runners.value).filter((s) => s.round > 0).length,
  )

  watch(runners, (map) => persistAll(map), { deep: true })

  function $reset(): void {
    runners.value = {}
    persistAll({})
  }

  return {
    runners,
    getState,
    start,
    end,
    step,
    back,
    damage,
    heal,
    setConditions,
    clear,
    activeRuns,
    $reset,
  }
})

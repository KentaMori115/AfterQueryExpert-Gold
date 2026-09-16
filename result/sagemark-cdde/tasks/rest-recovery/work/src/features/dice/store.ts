import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { generateId } from '@core/ids'
import {
  type RollResult,
  rollExpression,
} from '@core/dice/roll'

const HISTORY_KEY = 'sagemark:dice:history:v1'
const PRESETS_KEY = 'sagemark:dice:presets:v1'
const DEFAULT_HISTORY_DEPTH = 20

export interface DicePreset {
  id: string
  label: string
  expression: string
}

export interface DiceRollEntry {
  id: string
  result: RollResult
  label: string | null
}

function loadHistory(): DiceRollEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as DiceRollEntry[]
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

function loadPresets(): DicePreset[] {
  if (typeof window === 'undefined') return defaultPresets()
  try {
    const raw = window.localStorage.getItem(PRESETS_KEY)
    if (!raw) return defaultPresets()
    const parsed = JSON.parse(raw) as DicePreset[]
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultPresets()
    return parsed
  } catch {
    return defaultPresets()
  }
}

function defaultPresets(): DicePreset[] {
  return [
    { id: 'pre_attack', label: 'Attack roll', expression: 'd20 + 5' },
    { id: 'pre_save', label: 'Save with advantage', expression: 'd20adv + 2' },
    { id: 'pre_dmg', label: 'Greataxe damage', expression: '1d12 + 3' },
    { id: 'pre_stats', label: '4d6 keep highest 3', expression: '4d6kh3' },
  ]
}

function persistHistory(entries: ReadonlyArray<DiceRollEntry>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries))
  } catch {
    // best effort
  }
}

function persistPresets(presets: ReadonlyArray<DicePreset>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PRESETS_KEY, JSON.stringify(presets))
  } catch {
    // best effort
  }
}

export const useDiceStore = defineStore('dice', () => {
  const history = ref<DiceRollEntry[]>(loadHistory())
  const presets = ref<DicePreset[]>(loadPresets())
  const depth = ref<number>(DEFAULT_HISTORY_DEPTH)

  function roll(expression: string, label?: string | null): DiceRollEntry {
    const trimmed = expression.trim()
    const result = rollExpression(trimmed)
    const entry: DiceRollEntry = {
      id: generateId('rol'),
      result,
      label: label?.trim() ? label.trim() : null,
    }
    history.value = [entry, ...history.value].slice(0, depth.value)
    // Persisting eagerly inside the mutation rather than via watch(history, ...)
    // because the watcher fires async and the depth test in the spec re-inits
    // pinia before the next tick. Eager write keeps the contract obvious.
    persistHistory(history.value)
    return entry
  }

  function rollPreset(presetId: string): DiceRollEntry | null {
    const preset = presets.value.find((p) => p.id === presetId)
    if (!preset) return null
    return roll(preset.expression, preset.label)
  }

  function addPreset(label: string, expression: string): DicePreset {
    const preset: DicePreset = {
      id: generateId('pre'),
      label: label.trim() || expression.trim(),
      expression: expression.trim(),
    }
    presets.value = [...presets.value, preset]
    persistPresets(presets.value)
    return preset
  }

  function updatePreset(id: string, patch: Partial<Pick<DicePreset, 'label' | 'expression'>>): DicePreset | null {
    const idx = presets.value.findIndex((p) => p.id === id)
    if (idx === -1) return null
    const current = presets.value[idx]!
    const next: DicePreset = {
      ...current,
      label: (patch.label ?? current.label).trim() || current.expression,
      expression: (patch.expression ?? current.expression).trim(),
    }
    presets.value = [...presets.value.slice(0, idx), next, ...presets.value.slice(idx + 1)]
    persistPresets(presets.value)
    return next
  }

  function removePreset(id: string): boolean {
    const before = presets.value.length
    presets.value = presets.value.filter((p) => p.id !== id)
    const changed = presets.value.length !== before
    if (changed) persistPresets(presets.value)
    return changed
  }

  function clearHistory(): void {
    history.value = []
    persistHistory(history.value)
  }

  function setDepth(value: number): void {
    const clamped = Math.max(0, Math.min(200, Math.floor(value)))
    depth.value = clamped
    if (history.value.length > clamped) {
      history.value = history.value.slice(0, clamped)
      persistHistory(history.value)
    }
  }

  const lastRoll = computed<DiceRollEntry | null>(() => history.value[0] ?? null)
  const total = computed(() => history.value.length)

  watch(history, (h) => persistHistory(h), { deep: true })
  watch(presets, (p) => persistPresets(p), { deep: true })

  function $reset(): void {
    history.value = []
    presets.value = defaultPresets()
    depth.value = DEFAULT_HISTORY_DEPTH
  }

  return {
    history,
    presets,
    depth,
    lastRoll,
    total,
    roll,
    rollPreset,
    addPreset,
    updatePreset,
    removePreset,
    clearHistory,
    setDepth,
    $reset,
  }
})

<script setup lang="ts">
import { computed, ref } from 'vue'

import { DiceParseError } from '@core/dice/notation'
import { summariseResult } from '@core/dice/roll'

import BaseButton from '@ui/primitives/BaseButton.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'

import { useDiceStore, type DicePreset } from '../store'

const dice = useDiceStore()

const expression = ref('d20')
const label = ref('')
const error = ref<string | null>(null)
const newPresetLabel = ref('')
const newPresetExpression = ref('')

const recent = computed(() => dice.history.slice(0, 10))

function roll(): void {
  error.value = null
  try {
    dice.roll(expression.value, label.value)
    label.value = ''
  } catch (err) {
    if (err instanceof DiceParseError) {
      error.value = err.message
    } else {
      error.value = err instanceof Error ? err.message : 'unknown error'
    }
  }
}

function quickRoll(text: string): void {
  expression.value = text
  roll()
}

function rerunFromHistory(entry: { result: { expression: string }; label: string | null }): void {
  expression.value = entry.result.expression
  label.value = entry.label ?? ''
  roll()
}

function applyPreset(p: DicePreset): void {
  expression.value = p.expression
  label.value = p.label
}

function addPresetFromForm(): void {
  if (!newPresetExpression.value.trim()) return
  dice.addPreset(newPresetLabel.value, newPresetExpression.value)
  newPresetLabel.value = ''
  newPresetExpression.value = ''
}

function removePreset(p: DicePreset): void {
  if (!window.confirm(`Delete preset "${p.label}"?`)) return
  dice.removePreset(p.id)
}
</script>

<template>
  <div class="space-y-4">
    <div class="surface p-3 space-y-3">
      <h4 class="text-sm uppercase tracking-wider text-ink-400">Roll</h4>
      <div class="flex flex-wrap items-end gap-2">
        <label class="flex-1 min-w-[180px] text-xs text-ink-500">
          Expression
          <input
            id="dice-expression"
            v-model="expression"
            type="text"
            class="mt-1 w-full border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white font-mono"
            placeholder="d20 + 5"
          />
        </label>
        <label class="text-xs text-ink-500">
          Label (optional)
          <input
            v-model="label"
            type="text"
            class="mt-1 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
          />
        </label>
        <BaseButton tone="primary" type="button" @click="roll">Roll</BaseButton>
      </div>
      <div class="flex flex-wrap gap-1 text-xs">
        <button
          v-for="quick in ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']"
          :key="quick"
          type="button"
          class="px-2 py-1 rounded-full bg-parchment-100 hover:bg-parchment-200 text-ink-700"
          @click="quickRoll(quick)"
        >
          {{ quick }}
        </button>
      </div>
      <p v-if="error" class="text-xs text-crimson-600">{{ error }}</p>
    </div>

    <div class="surface p-3 space-y-2">
      <header class="flex items-center justify-between">
        <h4 class="text-sm uppercase tracking-wider text-ink-400">Recent</h4>
        <button
          v-if="dice.history.length > 0"
          type="button"
          class="text-xs text-ink-500 hover:text-ink-800"
          @click="dice.clearHistory"
        >
          clear
        </button>
      </header>
      <p v-if="recent.length === 0" class="text-xs text-ink-400">No rolls yet.</p>
      <ul v-else class="space-y-1 text-sm">
        <li v-for="entry in recent" :key="entry.id" class="flex items-center gap-2">
          <button
            type="button"
            class="text-ink-700 hover:text-ink-900 truncate flex-1 text-left"
            @click="rerunFromHistory(entry)"
          >
            <span v-if="entry.label" class="text-ink-500">{{ entry.label }}: </span>
            <span class="font-mono">{{ summariseResult(entry.result) }}</span>
          </button>
        </li>
      </ul>
    </div>

    <div class="surface p-3 space-y-3">
      <h4 class="text-sm uppercase tracking-wider text-ink-400">Presets</h4>
      <ul class="space-y-1 text-sm">
        <li
          v-for="p in dice.presets"
          :key="p.id"
          class="flex items-center gap-2"
        >
          <button
            type="button"
            class="text-left flex-1 text-ink-800 hover:text-ember-600 truncate"
            @click="applyPreset(p)"
          >
            <span>{{ p.label }}</span>
            <span class="ml-1 text-xs text-ink-400 font-mono">({{ p.expression }})</span>
          </button>
          <button
            type="button"
            class="text-xs text-ink-500 hover:text-ink-800"
            @click="dice.rollPreset(p.id)"
          >
            roll
          </button>
          <button
            type="button"
            class="text-xs text-crimson-600 hover:text-crimson-800"
            @click="removePreset(p)"
          >
            delete
          </button>
        </li>
      </ul>
      <form class="grid grid-cols-1 sm:grid-cols-2 gap-2" @submit.prevent="addPresetFromForm">
        <input
          id="preset-label"
          v-model="newPresetLabel"
          type="text"
          placeholder="Label"
          class="border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
        />
        <input
          id="preset-expression"
          v-model="newPresetExpression"
          type="text"
          placeholder="Expression"
          class="border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white font-mono"
        />
        <div class="sm:col-span-2 flex justify-end">
          <BaseButton tone="primary" size="sm" type="submit">Save preset</BaseButton>
        </div>
      </form>
    </div>

    <p v-if="dice.lastRoll" class="text-xs text-ink-500">
      Last total <StatusBadge tone="info">{{ dice.lastRoll.result.total }}</StatusBadge>
    </p>
  </div>
</template>

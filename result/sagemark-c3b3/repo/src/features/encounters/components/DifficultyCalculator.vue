<script setup lang="ts">
import { computed, reactive } from 'vue'

import {
  DIFFICULTY_ORDER,
  assessEncounter,
  difficultyTone,
  type EncounterDifficulty,
} from '@core/rules/encounter-difficulty'

import StatusBadge from '@ui/primitives/StatusBadge.vue'

interface MonsterRow {
  label: string
  xp: number
}

const state = reactive({
  partySize: 4,
  averageLevel: 5,
  rows: [
    { label: 'Goblin', xp: 50 },
    { label: 'Goblin', xp: 50 },
    { label: 'Hobgoblin', xp: 100 },
  ] as MonsterRow[],
})

const assessment = computed(() =>
  assessEncounter({
    party: { size: state.partySize, averageLevel: state.averageLevel },
    monsterXps: state.rows.map((r) => Number(r.xp) || 0),
  }),
)

const difficultyLabel: Record<EncounterDifficulty, string> = {
  trivial: 'Trivial',
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  deadly: 'Deadly',
}

function addRow(): void {
  state.rows.push({ label: '', xp: 100 })
}

function removeRow(idx: number): void {
  state.rows.splice(idx, 1)
}

function clearRows(): void {
  state.rows = []
}

function bandPct(d: EncounterDifficulty): number {
  const threshold = assessment.value.partyThresholds[d]
  if (threshold === 0) return 0
  const ratio = assessment.value.effectiveXp / threshold
  return Math.min(100, Math.round(ratio * 100))
}
</script>

<template>
  <div class="space-y-4">
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
      <label class="text-ink-500">
        Party size
        <input
          id="party-size"
          v-model.number="state.partySize"
          type="number"
          min="1"
          max="8"
          class="mt-1 w-full border border-parchment-300 rounded-soft px-2 py-1 bg-white"
        />
      </label>
      <label class="text-ink-500">
        Average level
        <input
          id="party-level"
          v-model.number="state.averageLevel"
          type="number"
          min="1"
          max="20"
          class="mt-1 w-full border border-parchment-300 rounded-soft px-2 py-1 bg-white"
        />
      </label>
      <div class="text-ink-500">
        Multiplier
        <p class="mt-1 text-ink-800 font-mono">x{{ assessment.multiplier }}</p>
      </div>
      <div class="text-ink-500">
        Effective xp
        <p class="mt-1 text-ink-800 font-mono">{{ assessment.effectiveXp }}</p>
      </div>
    </div>

    <table class="w-full text-sm">
      <thead>
        <tr class="text-ink-500 text-xs uppercase tracking-wide">
          <th class="text-left py-1">Monster</th>
          <th class="text-right py-1">XP</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, idx) in state.rows" :key="idx" class="border-t border-parchment-200">
          <td class="py-1">
            <input
              v-model="row.label"
              type="text"
              placeholder="eg Bugbear"
              class="w-full border border-parchment-300 rounded-soft px-2 py-1 bg-white"
            />
          </td>
          <td class="py-1 text-right">
            <input
              v-model.number="row.xp"
              type="number"
              min="0"
              class="w-24 border border-parchment-300 rounded-soft px-2 py-1 bg-white text-right"
            />
          </td>
          <td class="py-1 text-right">
            <button
              type="button"
              class="text-xs text-crimson-600 hover:text-crimson-800"
              @click="removeRow(idx)"
            >
              remove
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="flex flex-wrap gap-2 text-xs">
      <button
        type="button"
        class="px-2 py-1 rounded-soft bg-parchment-200 hover:bg-parchment-300"
        @click="addRow"
      >
        add row
      </button>
      <button
        v-if="state.rows.length > 0"
        type="button"
        class="px-2 py-1 rounded-soft bg-parchment-200 hover:bg-parchment-300"
        @click="clearRows"
      >
        clear
      </button>
    </div>

    <div class="space-y-1 text-sm">
      <div class="flex items-center justify-between">
        <span class="text-ink-500">Verdict</span>
        <StatusBadge :tone="difficultyTone(assessment.difficulty)" :soft="false">
          {{ difficultyLabel[assessment.difficulty] }}
        </StatusBadge>
      </div>
      <ul class="text-xs text-ink-600 space-y-1">
        <li v-for="d in DIFFICULTY_ORDER" :key="d" class="flex items-center gap-2">
          <span class="w-16 capitalize">{{ d }}</span>
          <div class="flex-1 h-1.5 rounded-full bg-parchment-200 overflow-hidden">
            <div class="h-full bg-ink-700" :style="{ width: bandPct(d) + '%' }"></div>
          </div>
          <span class="w-16 text-right font-mono">{{ assessment.partyThresholds[d] }} xp</span>
        </li>
      </ul>
    </div>
  </div>
</template>

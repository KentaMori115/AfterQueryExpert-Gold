<script setup lang="ts">
import { computed, ref } from 'vue'

import type { EncounterId } from '@core/ids'
import type { InitiativeEntry } from '@core/models/encounter'
import { turnOrderFor } from '../runner'

import BaseButton from '@ui/primitives/BaseButton.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'

import { useInitiativeStore } from '../store'

const props = defineProps<{
  encounterId: EncounterId
  entries: ReadonlyArray<InitiativeEntry>
}>()

const emit = defineEmits<{
  (e: 'entries-changed', next: InitiativeEntry[]): void
}>()

const runner = useInitiativeStore()
const damageAmount = ref<number>(1)
const healAmount = ref<number>(1)
const conditionDraft = ref('')
const conditionTarget = ref<string>('')

const state = computed(() => runner.getState(props.encounterId))
const order = computed(() => turnOrderFor(props.entries))
const active = computed(() => {
  const idx = state.value.round > 0 ? state.value.turnIndex : -1
  return idx >= 0 ? order.value[idx] ?? null : null
})

function start(): void {
  runner.start(props.encounterId)
}

function end(): void {
  runner.end(props.encounterId)
}

function step(): void {
  runner.step(props.encounterId, props.entries)
}

function back(): void {
  runner.back(props.encounterId, props.entries)
}

function applyDamageTo(index: number): void {
  const next = runner.damage(props.encounterId, [...props.entries], index, damageAmount.value)
  emit('entries-changed', next.entries)
}

function applyHealingTo(index: number): void {
  const next = runner.heal(props.encounterId, [...props.entries], index, healAmount.value)
  emit('entries-changed', next.entries)
}

function commitCondition(): void {
  const key = conditionTarget.value.trim()
  if (!key) return
  const conditions = conditionDraft.value
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
  runner.setConditions(props.encounterId, key, conditions)
  conditionDraft.value = ''
}
</script>

<template>
  <div class="space-y-3">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 class="text-sm uppercase tracking-wider text-ink-400">Initiative</h3>
        <p class="text-xs text-ink-500">
          <span v-if="state.round > 0">Round {{ state.round }}, {{ active?.name ?? 'no one' }} is up.</span>
          <span v-else>Not running yet.</span>
        </p>
      </div>
      <div class="flex gap-2">
        <BaseButton v-if="state.round === 0" tone="primary" @click="start">Begin combat</BaseButton>
        <template v-else>
          <BaseButton size="sm" @click="back">Back</BaseButton>
          <BaseButton size="sm" tone="primary" @click="step">Next turn</BaseButton>
          <BaseButton size="sm" tone="danger" @click="end">End combat</BaseButton>
        </template>
      </div>
    </header>

    <ol v-if="order.length > 0" class="space-y-1 text-sm">
      <li
        v-for="(entry, i) in order"
        :key="entry.name + '-' + entry.initiative"
        class="flex items-center gap-2 border-b border-parchment-200 pb-1"
        :class="state.round > 0 && i === state.turnIndex ? 'bg-parchment-50 -mx-1 px-1 rounded-soft' : ''"
      >
        <span class="w-8 text-right text-ink-500 font-mono">{{ entry.initiative }}</span>
        <span class="flex-1 truncate" :class="entry.hp <= 0 ? 'line-through text-ink-400' : 'text-ink-800'">
          {{ entry.name }}
        </span>
        <span class="font-mono text-xs text-ink-600">HP {{ entry.hp }}</span>
        <button
          type="button"
          class="px-2 text-xs text-crimson-600 hover:text-crimson-800"
          @click="applyDamageTo(i)"
        >
          dmg {{ damageAmount }}
        </button>
        <button
          type="button"
          class="px-2 text-xs text-moss-600 hover:text-moss-700"
          @click="applyHealingTo(i)"
        >
          heal {{ healAmount }}
        </button>
        <StatusBadge
          v-for="cond in state.conditions[entry.name] ?? []"
          :key="cond"
          tone="warning"
        >
          {{ cond }}
        </StatusBadge>
      </li>
    </ol>
    <p v-else class="text-xs text-ink-400">Add entries to the initiative list first.</p>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
      <label class="text-ink-500">
        Damage amount
        <input
          id="dmg-amount"
          v-model.number="damageAmount"
          type="number"
          min="1"
          class="mt-1 w-24 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
        />
      </label>
      <label class="text-ink-500">
        Heal amount
        <input
          id="heal-amount"
          v-model.number="healAmount"
          type="number"
          min="1"
          class="mt-1 w-24 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
        />
      </label>
    </div>

    <div class="text-xs space-y-1">
      <label class="text-ink-500" for="cond-target">
        Set conditions
        <div class="flex flex-wrap gap-1 mt-1">
          <input
            id="cond-target"
            v-model="conditionTarget"
            type="text"
            placeholder="who"
            class="border border-parchment-300 rounded-soft px-2 py-1 bg-white"
          />
          <input
            id="cond-list"
            v-model="conditionDraft"
            type="text"
            placeholder="prone, stunned"
            class="flex-1 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
          />
          <BaseButton size="sm" @click="commitCondition">Apply</BaseButton>
        </div>
      </label>
    </div>

    <details v-if="state.log.length > 0">
      <summary class="text-xs text-ink-500 cursor-pointer">Combat log ({{ state.log.length }})</summary>
      <ul class="mt-1 space-y-0.5 text-xs text-ink-700">
        <li v-for="(entry, i) in state.log" :key="i" class="font-mono">
          [r{{ entry.round }}] {{ entry.message }}
        </li>
      </ul>
    </details>
  </div>
</template>

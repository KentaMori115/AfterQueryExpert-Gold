<script setup lang="ts">
import { computed } from 'vue'

import type { CharacterId } from '@core/ids'
import {
  CONDITIONS,
  EXHAUSTION_LEVELS,
  type Condition,
  conditionDescription,
  conditionLabel,
  exhaustionLabel,
  exhaustionTone,
  hasDisadvantageOnAttacks,
  isIncapacitated,
} from '@core/rules/conditions'

import BaseButton from '@ui/primitives/BaseButton.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'

import { useConditionStore } from '../store'

const props = defineProps<{
  characterId: CharacterId
}>()

const store = useConditionStore()
const state = computed(() => store.get(props.characterId))

const incapacitated = computed(() => isIncapacitated(state.value))
const disadvantageOnAttacks = computed(() => hasDisadvantageOnAttacks(state.value))

function isActive(c: Condition): boolean {
  return state.value.active.includes(c)
}

function toggle(c: Condition): void {
  if (isActive(c)) store.remove(props.characterId, c)
  else store.add(props.characterId, c)
}

function setExhaustion(level: number): void {
  const delta = level - state.value.exhaustion
  if (delta !== 0) store.bumpExhaustion(props.characterId, delta)
}

function shortRest(): void {
  store.shortRest(props.characterId)
}

function longRest(): void {
  store.longRest(props.characterId)
}
</script>

<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-center gap-2 text-sm">
      <StatusBadge v-if="incapacitated" tone="danger" :soft="false">incapacitated</StatusBadge>
      <StatusBadge v-if="disadvantageOnAttacks" tone="warning">disadvantage on attacks</StatusBadge>
      <span class="ml-auto flex gap-2">
        <BaseButton size="sm" @click="shortRest">short rest</BaseButton>
        <BaseButton size="sm" tone="primary" @click="longRest">long rest</BaseButton>
      </span>
    </header>

    <section class="space-y-2">
      <h4 class="text-xs uppercase tracking-wide text-ink-500">Exhaustion</h4>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="level in EXHAUSTION_LEVELS"
          :key="level"
          type="button"
          class="px-2 py-1 rounded-soft text-xs"
          :class="
            state.exhaustion === level
              ? 'bg-ink-700 text-white'
              : 'bg-parchment-100 hover:bg-parchment-200 text-ink-700'
          "
          @click="setExhaustion(level)"
        >
          {{ level }}
        </button>
      </div>
      <StatusBadge :tone="exhaustionTone(state.exhaustion)">
        {{ exhaustionLabel(state.exhaustion) }}
      </StatusBadge>
    </section>

    <section class="space-y-2">
      <h4 class="text-xs uppercase tracking-wide text-ink-500">Conditions</h4>
      <ul class="grid grid-cols-2 sm:grid-cols-3 gap-1 text-xs">
        <li v-for="c in CONDITIONS" :key="c">
          <button
            type="button"
            class="w-full text-left px-2 py-1 rounded-soft border"
            :class="
              isActive(c)
                ? 'bg-ember-100 border-ember-300 text-ink-900'
                : 'bg-white border-parchment-200 hover:bg-parchment-100 text-ink-700'
            "
            :title="conditionDescription(c)"
            @click="toggle(c)"
          >
            <span class="capitalize">{{ conditionLabel(c) }}</span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import type { CharacterId } from '@core/ids'
import {
  type SpellLevel,
  totalMax,
  totalRemaining,
  visibleLevels,
} from '@core/rules/spell-slots'

import BaseButton from '@ui/primitives/BaseButton.vue'

import { useSpellSlotStore } from '../store'

const props = defineProps<{ characterId: CharacterId }>()

const store = useSpellSlotStore()
const slots = computed(() => store.get(props.characterId))

const bootstrapLevel = ref<number>(1)

const visible = computed<SpellLevel[]>(() => {
  const lvls = visibleLevels(slots.value)
  return lvls.length > 0 ? lvls : []
})

function spend(level: SpellLevel): void {
  store.spend(props.characterId, level)
}

function restore(level: SpellLevel): void {
  store.restore(props.characterId, level)
}

function longRest(): void {
  store.longRest(props.characterId)
}

function bootstrap(): void {
  store.bootstrap(props.characterId, bootstrapLevel.value)
}

function clear(): void {
  if (!window.confirm('Clear all slots for this character?')) return
  store.clear(props.characterId)
}
</script>

<template>
  <div class="space-y-3">
    <header class="flex flex-wrap items-center gap-3 text-sm">
      <span class="font-display">{{ totalRemaining(slots) }} / {{ totalMax(slots) }} slots left</span>
      <div class="ml-auto flex gap-2">
        <BaseButton size="sm" tone="primary" @click="longRest">long rest</BaseButton>
        <BaseButton size="sm" tone="danger" @click="clear">clear</BaseButton>
      </div>
    </header>

    <div v-if="visible.length === 0" class="text-sm text-ink-500 italic">
      No slots set. Pick a caster level and bootstrap.
    </div>

    <ul v-else class="space-y-2 text-sm">
      <li v-for="level in visible" :key="level" class="surface p-2 flex items-center gap-2">
        <span class="font-mono w-12">L{{ level }}</span>
        <span class="font-mono">{{ slots[level].remaining }} / {{ slots[level].max }}</span>
        <div class="flex flex-1 flex-wrap gap-1 mx-2">
          <span
            v-for="i in slots[level].max"
            :key="i"
            class="w-3 h-3 rounded-full"
            :class="i <= slots[level].remaining ? 'bg-ember-500' : 'border border-parchment-400'"
          ></span>
        </div>
        <button
          type="button"
          class="px-2 py-1 rounded-soft bg-parchment-200 hover:bg-parchment-300 text-xs"
          @click="spend(level)"
        >
          spend
        </button>
        <button
          type="button"
          class="px-2 py-1 rounded-soft bg-parchment-200 hover:bg-parchment-300 text-xs"
          @click="restore(level)"
        >
          restore
        </button>
      </li>
    </ul>

    <footer class="flex flex-wrap items-end gap-2 text-xs">
      <label class="text-ink-500">
        Caster level
        <input
          id="bootstrap-level"
          v-model.number="bootstrapLevel"
          type="number"
          min="1"
          max="20"
          class="mt-1 w-20 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
        />
      </label>
      <BaseButton size="sm" @click="bootstrap">bootstrap slots</BaseButton>
    </footer>
  </div>
</template>

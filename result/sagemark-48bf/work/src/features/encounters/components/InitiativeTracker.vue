<script setup lang="ts">
import { computed, reactive } from 'vue'

import {
  type InitiativeEntry,
  downedCount,
  rolledInitiativeOrder,
} from '@core/models/encounter'
import BaseButton from '@ui/primitives/BaseButton.vue'

const props = defineProps<{
  modelValue: ReadonlyArray<InitiativeEntry>
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: InitiativeEntry[]): void
}>()

const draft = reactive<{ name: string; initiative: number; hp: number; notes: string }>({
  name: '',
  initiative: 10,
  hp: 10,
  notes: '',
})

const ordered = computed(() => rolledInitiativeOrder(props.modelValue))
const downed = computed(() => downedCount(props.modelValue))

function add(): void {
  const trimmed = draft.name.trim()
  if (!trimmed) return
  const next: InitiativeEntry[] = [
    ...props.modelValue,
    {
      characterId: null,
      name: trimmed,
      initiative: Number(draft.initiative) || 0,
      hp: Number(draft.hp) || 0,
      notes: draft.notes.trim(),
    },
  ]
  emit('update:modelValue', next)
  draft.name = ''
  draft.notes = ''
}

function removeAt(idxInOrdered: number): void {
  const target = ordered.value[idxInOrdered]
  if (!target) return
  const next = props.modelValue.filter((e) => e !== target)
  emit('update:modelValue', next as InitiativeEntry[])
}

function adjustHpAt(idxInOrdered: number, delta: number): void {
  const target = ordered.value[idxInOrdered]
  if (!target) return
  const next = props.modelValue.map((e) =>
    e === target ? { ...e, hp: e.hp + delta } : e,
  )
  emit('update:modelValue', next as InitiativeEntry[])
}
</script>

<template>
  <div class="space-y-3">
    <ul v-if="ordered.length > 0" class="space-y-1 text-sm">
      <li
        v-for="(entry, i) in ordered"
        :key="i"
        class="flex items-center gap-2 border-b border-parchment-200 pb-1"
        :class="entry.hp <= 0 ? 'opacity-50 line-through' : ''"
      >
        <span class="w-8 text-right text-ink-500 font-mono">{{ entry.initiative }}</span>
        <span class="flex-1 min-w-0 truncate">{{ entry.name }}</span>
        <button type="button" class="px-1 text-xs text-ink-500 hover:text-ink-800" @click="adjustHpAt(i, -1)">-</button>
        <span class="font-mono text-xs text-ink-600">{{ entry.hp }}</span>
        <button type="button" class="px-1 text-xs text-ink-500 hover:text-ink-800" @click="adjustHpAt(i, 1)">+</button>
        <button type="button" class="px-2 text-xs text-crimson-600 hover:text-crimson-800" @click="removeAt(i)">remove</button>
      </li>
    </ul>
    <p v-else class="text-xs text-ink-500">No one in the order yet.</p>

    <p v-if="downed > 0" class="text-xs text-ink-400">{{ downed }} downed</p>

    <form class="flex flex-wrap gap-2 items-end" @submit.prevent="add">
      <div class="flex-1 min-w-[140px]">
        <label class="block text-xs text-ink-500" for="init-name">Name</label>
        <input
          id="init-name"
          v-model="draft.name"
          type="text"
          class="w-full border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
        />
      </div>
      <div>
        <label class="block text-xs text-ink-500" for="init-roll">Init</label>
        <input
          id="init-roll"
          v-model.number="draft.initiative"
          type="number"
          class="w-16 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
        />
      </div>
      <div>
        <label class="block text-xs text-ink-500" for="init-hp">HP</label>
        <input
          id="init-hp"
          v-model.number="draft.hp"
          type="number"
          class="w-20 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
        />
      </div>
      <BaseButton tone="primary" size="sm" type="submit">Add</BaseButton>
    </form>
  </div>
</template>

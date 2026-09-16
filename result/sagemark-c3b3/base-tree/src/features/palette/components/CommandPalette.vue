<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import { useCommands, type PaletteCommand } from '../useCommands'

const props = defineProps<{
  open: boolean
}>()
const emit = defineEmits<{
  (e: 'close'): void
}>()

const { search } = useCommands()
const query = ref('')
const highlighted = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)

const results = computed<PaletteCommand[]>(() => search(query.value))

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      query.value = ''
      highlighted.value = 0
      await nextTick()
      inputEl.value?.focus()
    }
  },
)

watch(results, () => {
  if (highlighted.value >= results.value.length) {
    highlighted.value = Math.max(0, results.value.length - 1)
  }
})

function runHighlighted(): void {
  const cmd = results.value[highlighted.value]
  if (!cmd) return
  cmd.perform()
  emit('close')
}

function pick(cmd: PaletteCommand): void {
  cmd.perform()
  emit('close')
}

function moveDown(): void {
  if (results.value.length === 0) return
  highlighted.value = (highlighted.value + 1) % results.value.length
}

function moveUp(): void {
  if (results.value.length === 0) return
  highlighted.value = (highlighted.value - 1 + results.value.length) % results.value.length
}

function closeOnBackdrop(event: MouseEvent): void {
  if (event.target === event.currentTarget) emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.open"
      class="fixed inset-0 bg-ink-900/40 flex items-start justify-center pt-24 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      @click="closeOnBackdrop"
    >
      <div class="w-full max-w-xl bg-white rounded-soft shadow-floating overflow-hidden">
        <div class="px-3 py-2 border-b border-parchment-200">
          <input
            ref="inputEl"
            v-model="query"
            type="search"
            placeholder="Find anything, jump anywhere"
            class="w-full text-sm bg-transparent focus:outline-none"
            @keydown.escape.prevent="emit('close')"
            @keydown.down.prevent="moveDown"
            @keydown.up.prevent="moveUp"
            @keydown.enter.prevent="runHighlighted"
          />
        </div>
        <ul class="max-h-72 overflow-y-auto">
          <li
            v-for="(cmd, i) in results"
            :key="cmd.id"
            class="px-3 py-2 cursor-pointer text-sm"
            :class="i === highlighted ? 'bg-parchment-100' : 'hover:bg-parchment-50'"
            @mouseenter="highlighted = i"
            @click="pick(cmd)"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="truncate text-ink-800">{{ cmd.label }}</span>
              <span class="text-xs text-ink-400 truncate">{{ cmd.hint }}</span>
            </div>
          </li>
          <li v-if="results.length === 0" class="px-3 py-4 text-center text-sm text-ink-400">
            Nothing matched.
          </li>
        </ul>
        <div class="px-3 py-2 border-t border-parchment-200 text-xs text-ink-400 flex justify-between">
          <span>↑↓ to move</span>
          <span>Enter to open</span>
          <span>Esc to dismiss</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import type { Tag } from '@core/models/tag'
import { toneClass } from '@core/models/tag'

const props = withDefaults(
  defineProps<{
    tag: Tag
    removable?: boolean
    interactive?: boolean
  }>(),
  { removable: false, interactive: false },
)

const emit = defineEmits<{
  (e: 'remove'): void
  (e: 'pick'): void
}>()

const cls = computed(() => {
  const base = 'inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full'
  const hover = props.interactive ? 'hover:ring-2 hover:ring-ink-300/40 cursor-pointer' : ''
  return `${base} ${toneClass(props.tag.tone)} ${hover}`.trim()
})

function pick(): void {
  if (props.interactive) emit('pick')
}
</script>

<template>
  <span :class="cls" :title="tag.description || tag.name" @click="pick">
    <span class="font-mono">#</span>
    <span>{{ tag.name }}</span>
    <button
      v-if="removable"
      type="button"
      class="ml-1 text-current/70 hover:text-current"
      :aria-label="'Remove tag ' + tag.name"
      @click.stop="emit('remove')"
    >
      ×
    </button>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent'

const props = withDefaults(
  defineProps<{
    tone?: Tone
    soft?: boolean
  }>(),
  { tone: 'neutral', soft: true },
)

const cls = computed(() => {
  const base = 'inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full'
  if (!props.soft) {
    switch (props.tone) {
      case 'success':
        return `${base} bg-moss-500 text-white`
      case 'warning':
        return `${base} bg-ember-500 text-white`
      case 'danger':
        return `${base} bg-crimson-500 text-white`
      case 'info':
        return `${base} bg-ink-700 text-white`
      case 'accent':
        return `${base} bg-parchment-700 text-parchment-50`
      default:
        return `${base} bg-ink-200 text-ink-800`
    }
  }
  switch (props.tone) {
    case 'success':
      return `${base} bg-moss-400/20 text-moss-600`
    case 'warning':
      return `${base} bg-ember-100 text-ember-700`
    case 'danger':
      return `${base} bg-crimson-400/20 text-crimson-600`
    case 'info':
      return `${base} bg-ink-100 text-ink-700`
    case 'accent':
      return `${base} bg-parchment-100 text-parchment-800`
    default:
      return `${base} bg-parchment-100 text-ink-700`
  }
})
</script>

<template>
  <span :class="cls"><slot /></span>
</template>

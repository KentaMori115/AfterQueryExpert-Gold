<script setup lang="ts">
import { computed } from 'vue'

type Tone = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const props = withDefaults(
  defineProps<{
    tone?: Tone
    size?: Size
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
    block?: boolean
  }>(),
  {
    tone: 'secondary',
    size: 'md',
    type: 'button',
    disabled: false,
    block: false,
  },
)

defineEmits<{ (e: 'click', ev: MouseEvent): void }>()

const toneClass = computed(() => {
  switch (props.tone) {
    case 'primary':
      return 'bg-ember-500 text-white hover:bg-ember-600 focus-visible:ring-ember-400 disabled:bg-ember-200'
    case 'ghost':
      return 'bg-transparent text-ink-700 hover:bg-parchment-100 focus-visible:ring-parchment-400 disabled:text-ink-300'
    case 'danger':
      return 'bg-crimson-500 text-white hover:bg-crimson-600 focus-visible:ring-crimson-400 disabled:bg-crimson-400'
    default:
      return 'bg-parchment-100 text-ink-800 border border-parchment-300 hover:bg-parchment-200 focus-visible:ring-parchment-400 disabled:opacity-60'
  }
})

const sizeClass = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'px-2.5 py-1 text-sm rounded'
    case 'lg':
      return 'px-5 py-2.5 text-base rounded-soft'
    default:
      return 'px-3.5 py-1.5 text-sm rounded-soft'
  }
})
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    :class="[
      'inline-flex items-center justify-center font-medium transition focus:outline-none focus-visible:ring-2',
      toneClass,
      sizeClass,
      block ? 'w-full' : '',
      'disabled:cursor-not-allowed',
    ]"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>

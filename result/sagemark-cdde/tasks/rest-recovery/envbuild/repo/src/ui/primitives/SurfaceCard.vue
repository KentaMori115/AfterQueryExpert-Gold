<script setup lang="ts">
defineProps<{
  title?: string
  hint?: string
  as?: 'div' | 'section' | 'article'
}>()
</script>

<template>
  <component :is="as ?? 'div'" class="surface p-4">
    <div v-if="title || hint || $slots.header" class="flex items-start justify-between gap-3 mb-3">
      <div>
        <h2 v-if="title" class="text-lg font-display text-ink-900">{{ title }}</h2>
        <p v-if="hint" class="text-sm text-ink-500">{{ hint }}</p>
      </div>
      <slot name="header" />
    </div>
    <slot />
    <div v-if="$slots.footer" class="mt-3 pt-3 border-t border-parchment-200">
      <slot name="footer" />
    </div>
  </component>
</template>

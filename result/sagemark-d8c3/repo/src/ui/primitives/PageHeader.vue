<script setup lang="ts">
defineProps<{
  title: string
  subtitle?: string
  meta?: string
}>()
</script>

<template>
  <header class="flex flex-wrap items-end justify-between gap-3 border-b border-parchment-200 pb-4">
    <div class="min-w-0">
      <h1 class="text-3xl font-display text-ink-900 truncate">{{ title }}</h1>
      <p v-if="subtitle" class="mt-1 text-ink-600">{{ subtitle }}</p>
      <p v-if="meta" class="mt-1 text-xs uppercase tracking-wide text-ink-400">{{ meta }}</p>
    </div>
    <div v-if="$slots.default" class="flex flex-wrap items-center gap-2">
      <slot />
    </div>
  </header>
</template>

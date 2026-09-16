<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  icon?: string
}>()
</script>

<template>
  <div class="text-center py-10 px-4">
    <div
      v-if="icon"
      class="mx-auto mb-3 w-12 h-12 rounded-full bg-parchment-100 text-parchment-700 flex items-center justify-center text-2xl"
      aria-hidden="true"
    >
      {{ icon }}
    </div>
    <h3 class="text-xl font-display text-ink-800">{{ title }}</h3>
    <p v-if="description" class="mt-1 text-ink-500 max-w-md mx-auto">
      {{ description }}
    </p>
    <div v-if="$slots.action" class="mt-4">
      <slot name="action" />
    </div>
  </div>
</template>

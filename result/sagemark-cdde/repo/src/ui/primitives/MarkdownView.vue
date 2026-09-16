<script setup lang="ts">
import { computed } from 'vue'

import { renderMarkdown } from '@core/lib/markdown'

const props = defineProps<{
  source: string
  autoLink?: boolean
  empty?: string
}>()

const rendered = computed(() => renderMarkdown(props.source ?? '', { autoLink: props.autoLink ?? true }))
const hasContent = computed(() => props.source && props.source.trim().length > 0)
</script>

<template>
  <div v-if="hasContent" class="prose prose-sm text-ink-700 leading-relaxed space-y-2" v-html="rendered" />
  <p v-else class="text-sm text-ink-400">{{ empty ?? 'Nothing to show.' }}</p>
</template>

<style scoped>
.prose :deep(h1) {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 1.5rem;
  color: #21180c;
}
.prose :deep(h2) {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 1.25rem;
  color: #21180c;
}
.prose :deep(h3) {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 1.1rem;
  color: #21180c;
}
.prose :deep(a) {
  color: #bb4313;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.prose :deep(code) {
  background: #f4ecd5;
  padding: 0 0.25rem;
  border-radius: 0.25rem;
  font-size: 0.85em;
}
</style>

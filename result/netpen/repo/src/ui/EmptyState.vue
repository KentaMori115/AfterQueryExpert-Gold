<script setup lang="ts">
/** Nothing to show, which is not the same as something being wrong. */
withDefaults(defineProps<{ readonly title: string; readonly body?: string }>(), {
  body: undefined,
});
</script>

<template>
  <div class="empty">
    <span class="title">{{ title }}</span>
    <span v-if="body !== undefined" class="body">{{ body }}</span>
    <span v-if="$slots.action" class="action"><slot name="action" /></span>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--gap-2);
  padding: var(--gap-7) var(--gap-5);
  text-align: center;
  color: var(--ink-secondary);
}

.title {
  font-size: var(--type-md);
  font-weight: 600;
  color: var(--ink-primary);
}

.body {
  font-size: var(--type-sm);
  max-width: 48ch;
}

.action {
  margin-top: var(--gap-2);
}
</style>

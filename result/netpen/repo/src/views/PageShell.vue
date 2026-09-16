<script setup lang="ts">
/**
 * A section that is routed but not built yet.
 *
 * Kept explicit rather than leaving the route out, so the rail shows the shape
 * of the application and nobody has to guess whether a missing page is a bug
 * or a gap. Each of these is replaced by the real screen as it lands.
 */
defineProps<{
  readonly title: string;
  readonly note: string;
}>();
</script>

<template>
  <section class="shell">
    <h2>{{ title }}</h2>
    <p class="note">{{ note }}</p>
  </section>
</template>

<style scoped>
.shell {
  padding: var(--gap-6);
  border: 1px dashed var(--rule-firm);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.note {
  margin: var(--gap-2) 0 0;
  color: var(--ink-muted);
  font-size: var(--type-sm);
  max-width: 60ch;
}
</style>

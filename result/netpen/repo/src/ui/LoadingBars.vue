<script setup lang="ts">
/**
 * Loading, empty and broken are three different things, and a screen that
 * shows the wrong one tells the crew something false. This is only the first
 * of them: work is in progress and nothing is known yet.
 */
withDefaults(defineProps<{ readonly lines?: number; readonly label?: string }>(), {
  lines: 3,
  label: 'Loading',
});
</script>

<template>
  <div class="stack" role="status" aria-live="polite" :aria-label="label">
    <span
      v-for="index in lines"
      :key="index"
      class="bar"
      :style="{ width: `${100 - (index - 1) * 12}%` }"
      aria-hidden="true"
    />
  </div>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: var(--gap-2);
  padding: var(--gap-4);
}

.bar {
  height: 12px;
  border-radius: var(--radius-xs);
  background: linear-gradient(
    90deg,
    var(--surface-sunken) 0%,
    var(--rule-hair) 50%,
    var(--surface-sunken) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1400ms ease-in-out infinite;
}

@keyframes shimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}
</style>

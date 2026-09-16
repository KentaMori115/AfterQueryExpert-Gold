<script setup lang="ts">
import type { Tone } from './tones';

/**
 * A small state label.
 *
 * Solid is for the one badge in a row that has to win the eye. More than one
 * per row and none of them do.
 */
withDefaults(
  defineProps<{
    readonly tone?: Tone;
    readonly solid?: boolean;
    readonly dot?: boolean;
    readonly title?: string;
  }>(),
  { tone: 'neutral', solid: false, dot: false, title: undefined },
);
</script>

<template>
  <span class="badge" :class="[tone, { solid }]" :title="title">
    <span v-if="dot" class="dot" aria-hidden="true" />
    <slot />
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-1);
  padding: 1px var(--gap-2);
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  font-size: var(--type-xs);
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  white-space: nowrap;
}

.neutral {
  background: var(--surface-sunken);
  border-color: var(--rule-hair);
  color: var(--ink-secondary);
}

.info {
  background: var(--accent-wash);
  border-color: var(--accent);
  color: var(--accent);
}

.good {
  background: var(--pass-wash);
  border-color: var(--pass);
  color: var(--pass);
}

.caution {
  background: var(--caution-wash);
  border-color: var(--caution);
  color: var(--caution);
}

.bad {
  background: var(--fault-wash);
  border-color: var(--fault);
  color: var(--fault);
}

.solid.info {
  background: var(--accent);
  color: #ffffff;
}
.solid.good {
  background: var(--pass);
  color: #ffffff;
}
.solid.caution {
  background: var(--caution);
  color: #ffffff;
}
.solid.bad {
  background: var(--fault);
  color: #ffffff;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex: none;
}
</style>

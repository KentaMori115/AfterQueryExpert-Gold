<script setup lang="ts">
import { computed } from 'vue';

import { MISSING } from '@/ui/format';

import type { Tone } from './tones';

/**
 * A single number with its label, unit and one line of context.
 *
 * The value arrives already formatted. Precision belongs to the domain: a lice
 * count is written to two places because the register says so, and a component
 * that rounds is a component that can disagree with the record it displays.
 *
 * The unit sits outside the tabular figure so a row of tiles keeps its decimal
 * points lined up whatever the units are.
 */
const props = withDefaults(
  defineProps<{
    readonly label: string;
    /** Already formatted; the tile never decides precision. */
    readonly value: string;
    readonly unit?: string;
    readonly detail?: string;
    readonly tone?: Tone | 'plain' | 'muted';
    readonly compact?: boolean;
  }>(),
  { unit: undefined, detail: undefined, tone: 'plain', compact: false },
);

const missing = computed(() => props.value === MISSING);
const shown = computed(() => (missing.value ? 'muted' : props.tone));
</script>

<template>
  <div class="tile" :class="[shown, { compact }]">
    <span class="label">
      {{ label }}
      <slot name="badge" />
    </span>
    <span class="row">
      <span class="value">{{ value }}</span>
      <span v-if="unit !== undefined && !missing" class="unit">{{ unit }}</span>
    </span>
    <span v-if="detail !== undefined" class="detail">{{ detail }}</span>
  </div>
</template>

<style scoped>
.tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--gap-3) var(--gap-4);
  border: 1px solid var(--rule-hair);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  min-width: 0;
}

.label {
  display: flex;
  align-items: center;
  gap: var(--gap-2);
  font-size: var(--type-xs);
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.row {
  display: flex;
  align-items: baseline;
  gap: var(--gap-2);
  min-width: 0;
}

.value {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  font-size: var(--type-xl);
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
}

.unit {
  font-size: var(--type-sm);
  color: var(--ink-secondary);
  flex: none;
}

.detail {
  font-size: var(--type-sm);
  color: var(--ink-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.good .value {
  color: var(--pass);
}
.caution .value {
  color: var(--caution);
}
.bad .value {
  color: var(--fault);
}
.info .value {
  color: var(--accent);
}
.muted .value {
  color: var(--ink-muted);
}

.compact {
  padding: var(--gap-2) var(--gap-3);
}

.compact .value {
  font-size: var(--type-lg);
}
</style>

<script setup lang="ts">
/**
 * The one big number at the top of a panel.
 *
 * Four panels had their own copy, and the type sizes had drifted by a step
 * between them, which is visible the moment the lice panel and the feed panel
 * sit side by side on the pen page.
 *
 * The value arrives formatted, as it does on the stat tile and for the same
 * reason: precision belongs to whatever produced the number. A lice count is
 * written to two places because the register says so, and a component that
 * rounded could disagree with the record beneath it.
 */
withDefaults(
  defineProps<{
    /** Already formatted; this never decides precision. */
    readonly value: string;
    readonly label?: string;
    readonly unit?: string;
    /** For a figure that is a low or a worst rather than a current reading. */
    readonly muted?: boolean;
  }>(),
  { label: undefined, unit: undefined, muted: false },
);
</script>

<template>
  <div class="figure">
    <p class="line">
      <span class="value" :class="{ muted }">{{ value }}</span>
      <span v-if="unit !== undefined" class="unit">{{ unit }}</span>
    </p>
    <span v-if="label !== undefined" class="label">{{ label }}</span>
    <slot name="label" />
  </div>
</template>

<style scoped>
.figure {
  min-width: 0;
}

.line {
  display: flex;
  align-items: baseline;
  gap: var(--gap-2);
  margin: 0;
}

.value {
  font-family: var(--font-num);
  font-size: var(--type-2xl);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.muted {
  color: var(--caution);
}

.unit,
.label {
  color: var(--ink-muted);
  font-size: var(--type-sm);
}

.label {
  display: block;
}
</style>

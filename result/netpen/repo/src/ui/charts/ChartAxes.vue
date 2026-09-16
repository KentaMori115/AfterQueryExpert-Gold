<script setup lang="ts">
import { computed } from 'vue';

import { SERIES_COLOURS, type Margin } from './theme';

/**
 * Tick labels and grid lines, drawn once.
 *
 * The three charts each carried their own copy of this, and the copies had
 * already come apart: one put its labels six pixels from the axis and another
 * eight, one drew grid lines and the others did not, and the vertical offset
 * that centres a label on its tick differed in all three. On a screen showing
 * two of them side by side that reads as sloppiness, because it is.
 *
 * It takes formatters rather than values so it stays out of the business of
 * deciding precision. A lice figure is written to two places because the
 * register says so, and an axis that rounded would disagree with the bars
 * sitting on it.
 */
export interface Plot {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

const props = withDefaults(
  defineProps<{
    readonly plot: Plot;
    readonly xTicks: readonly number[];
    readonly yTicks: readonly number[];
    readonly toX: (value: number) => number;
    readonly toY: (value: number) => number;
    readonly formatX?: (value: number) => string;
    readonly formatY?: (value: number) => string;
    /** Horizontal rules behind the series. Off where bars already carry the eye. */
    readonly grid?: boolean;
    readonly margin?: Margin;
  }>(),
  {
    formatX: (value: number) => String(value),
    formatY: (value: number) => String(value),
    grid: false,
    margin: undefined,
  },
);

/** Centres a label on its tick rather than hanging it from the baseline. */
const LABEL_RISE = 4;
const LABEL_GAP = 6;
const X_LABEL_DROP = 16;

const xLabelY = computed(() => props.plot.bottom + X_LABEL_DROP);
</script>

<template>
  <g class="axis">
    <template v-if="grid">
      <line
        v-for="tick in yTicks"
        :key="`g-${tick}`"
        class="grid"
        :x1="plot.left"
        :x2="plot.right"
        :y1="toY(tick)"
        :y2="toY(tick)"
      />
    </template>

    <text
      v-for="tick in yTicks"
      :key="`y-${tick}`"
      :x="plot.left - LABEL_GAP"
      :y="toY(tick) + LABEL_RISE"
      text-anchor="end"
    >
      {{ formatY(tick) }}
    </text>

    <text
      v-for="tick in xTicks"
      :key="`x-${tick}`"
      :x="toX(tick)"
      :y="xLabelY"
      text-anchor="middle"
    >
      {{ formatX(tick) }}
    </text>
  </g>
</template>

<style scoped>
text {
  fill: v-bind('SERIES_COLOURS.axis');
}

.grid {
  stroke: v-bind('SERIES_COLOURS.grid');
  stroke-width: 1;
}
</style>

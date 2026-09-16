<script setup lang="ts">
import { computed } from 'vue';

import ChartAxes from './ChartAxes.vue';
import { linePath, thin, type Point } from './path';
import {
  DEFAULT_MARGIN,
  extentOf,
  niceExtent,
  scaleLinear,
  SERIES_COLOURS,
  SERIES_DASH,
  ticksFor,
  type Extent,
  type SeriesKey,
} from './theme';

/**
 * A multi-series trace over a numeric axis.
 *
 * Drawn into a viewBox rather than measured, so it scales with its column
 * without a resize observer, renders identically in a test, and prints at
 * whatever size the paper is. Charts that measure their container are a
 * recurring source of blank boxes in jsdom and of a first paint at the wrong
 * size in the browser; this has neither problem.
 */

export interface TraceSeries {
  readonly key: SeriesKey;
  readonly label: string;
  readonly points: readonly Point[];
}

export interface ReferenceLine {
  readonly value: number;
  readonly label: string;
  readonly key?: SeriesKey;
}

const props = withDefaults(
  defineProps<{
    readonly series: readonly TraceSeries[];
    readonly caption: string;
    readonly xLabel?: string;
    readonly yLabel?: string;
    readonly references?: readonly ReferenceLine[];
    /** Forces the y extent, for an axis that should not float. */
    readonly yExtent?: Extent;
    readonly height?: number;
    readonly maxPoints?: number;
    readonly formatX?: (value: number) => string;
    readonly formatY?: (value: number) => string;
  }>(),
  {
    xLabel: undefined,
    yLabel: undefined,
    references: () => [],
    yExtent: undefined,
    height: 220,
    maxPoints: 200,
    formatX: (value: number) => String(Math.round(value)),
    formatY: (value: number) => String(Math.round(value * 100) / 100),
  },
);

const WIDTH = 720;
const margin = DEFAULT_MARGIN;

const thinned = computed(() =>
  props.series.map((entry) => ({ ...entry, points: thin(entry.points, props.maxPoints) })),
);

const hasData = computed(() =>
  thinned.value.some((entry) => entry.points.some((point) => point.y !== null)),
);

const xExtent = computed(() =>
  niceExtent(extentOf(thinned.value.flatMap((entry) => entry.points.map((point) => point.x))), {
    min: 0,
    max: 1,
  }),
);

const yExtent = computed(() => {
  if (props.yExtent !== undefined) return props.yExtent;
  const values = thinned.value.flatMap((entry) =>
    entry.points.map((point) => point.y).filter((value): value is number => value !== null),
  );
  const withReferences = [...values, ...props.references.map((reference) => reference.value)];
  return niceExtent(extentOf(withReferences), { min: 0, max: 1 });
});

const plot = computed(() => ({
  left: margin.left,
  right: WIDTH - margin.right,
  top: margin.top,
  bottom: props.height - margin.bottom,
}));

const projection = computed(() => ({
  toX: scaleLinear(xExtent.value, plot.value.left, plot.value.right),
  toY: scaleLinear(yExtent.value, plot.value.bottom, plot.value.top),
}));

const xTicks = computed(() => ticksFor(xExtent.value, 6));
const yTicks = computed(() => ticksFor(yExtent.value, 4));

function pathFor(entry: TraceSeries): string {
  return linePath(entry.points, projection.value);
}
</script>

<template>
  <figure class="chart">
    <figcaption class="sr-only">{{ caption }}</figcaption>

    <div v-if="series.length > 0" class="legend">
      <span v-for="entry in series" :key="entry.key" class="entry">
        <span
          class="swatch"
          :style="{
            borderTopColor: SERIES_COLOURS[entry.key],
            borderTopStyle: SERIES_DASH[entry.key] === undefined ? 'solid' : 'dashed',
          }"
        />
        {{ entry.label }}
      </span>
      <span v-for="reference in references" :key="reference.label" class="entry">
        <span
          class="swatch"
          :style="{
            borderTopColor: SERIES_COLOURS[reference.key ?? 'licence'],
            borderTopStyle: 'dashed',
          }"
        />
        {{ reference.label }}
      </span>
    </div>

    <p v-if="!hasData" class="empty">Nothing recorded in this window</p>

    <svg
      v-else
      class="plot"
      :viewBox="`0 0 ${WIDTH} ${height}`"
      preserveAspectRatio="none"
      role="img"
      :aria-label="caption"
    >
      <ChartAxes
        :plot="plot"
        :x-ticks="xTicks"
        :y-ticks="yTicks"
        :to-x="projection.toX"
        :to-y="projection.toY"
        :format-x="formatX"
        :format-y="formatY"
        grid
      />

      <line
        v-for="reference in references"
        :key="`ref-${reference.label}`"
        class="reference"
        :x1="plot.left"
        :x2="plot.right"
        :y1="projection.toY(reference.value)"
        :y2="projection.toY(reference.value)"
        :stroke="SERIES_COLOURS[reference.key ?? 'licence']"
      />

      <path
        v-for="entry in thinned"
        :key="entry.key"
        class="trace"
        :d="pathFor(entry)"
        :stroke="SERIES_COLOURS[entry.key]"
        :stroke-dasharray="SERIES_DASH[entry.key]"
      />
    </svg>

    <p v-if="xLabel !== undefined || yLabel !== undefined" class="axisLabels">
      <span v-if="yLabel !== undefined">{{ yLabel }}</span>
      <span v-if="xLabel !== undefined">{{ xLabel }}</span>
    </p>
  </figure>
</template>

<style scoped>
.chart {
  margin: 0;
  width: 100%;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-3);
  padding-bottom: var(--gap-2);
  font-size: var(--type-xs);
  color: var(--ink-secondary);
}

.entry {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-2);
}

.swatch {
  width: 14px;
  height: 0;
  border-top-width: 2px;
}

.plot {
  width: 100%;
  height: auto;
  display: block;
}

.reference {
  stroke-width: 1.5;
  stroke-dasharray: 7 4;
}

.trace {
  fill: none;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.empty {
  padding: var(--gap-6);
  text-align: center;
  color: var(--ink-muted);
  font-size: var(--type-sm);
  border: 1px dashed var(--rule-hair);
  border-radius: var(--radius-sm);
}

.axisLabels {
  display: flex;
  justify-content: space-between;
  margin: var(--gap-1) 0 0;
  font-size: var(--type-xs);
  color: var(--ink-muted);
}
</style>

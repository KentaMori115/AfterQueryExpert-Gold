<script setup lang="ts">
import { computed } from 'vue';

import { limitFor, type Regime } from '@/domain/lice/thresholds';
import type { IsoWeek } from '@/domain/time/duration';

import ChartAxes from './ChartAxes.vue';
import {
  DEFAULT_MARGIN,
  extentOf,
  niceExtent,
  scaleLinear,
  SERIES_COLOURS,
  ticksFor,
} from './theme';

/**
 * The weekly lice record.
 *
 * A bar per count with the limit drawn over it, and the limit is a step rather
 * than a line because it tightens for the six weeks of the spring window. That
 * step is the whole point of the chart: a pen sitting comfortably at 0.35 in
 * week 15 is in breach in week 16 without a single louse having changed, and a
 * flat threshold line hides exactly that.
 *
 * Bars over the limit are drawn in the alarm colour rather than merely being
 * above a line, because the line is easy to miss on a bright screen.
 */

export interface WeeklyPoint {
  readonly week: IsoWeek;
  readonly value: number;
  /** Week number of the cycle, which is what the axis counts in. */
  readonly cycleWeek: number;
}

const props = withDefaults(
  defineProps<{
    readonly points: readonly WeeklyPoint[];
    readonly regime: Regime;
    readonly caption: string;
    readonly height?: number;
  }>(),
  { height: 200 },
);

const WIDTH = 720;
const margin = DEFAULT_MARGIN;

const plot = computed(() => ({
  left: margin.left,
  right: WIDTH - margin.right,
  top: margin.top,
  bottom: props.height - margin.bottom,
}));

const limits = computed(() => props.points.map((point) => limitFor(props.regime, point.week)));

const yExtent = computed(() =>
  niceExtent(extentOf([...props.points.map((point) => point.value), ...limits.value, 0]), {
    min: 0,
    max: 1,
  }),
);

const xExtent = computed(() =>
  niceExtent(extentOf(props.points.map((point) => point.cycleWeek)), { min: 0, max: 1 }),
);

const toX = computed(() => scaleLinear(xExtent.value, plot.value.left, plot.value.right));
const toY = computed(() => scaleLinear(yExtent.value, plot.value.bottom, plot.value.top));

const barWidth = computed(() => {
  const span = plot.value.right - plot.value.left;
  return Math.max(2, Math.min(14, span / Math.max(1, props.points.length) - 2));
});

interface Bar {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly over: boolean;
  readonly label: string;
}

const bars = computed<Bar[]>(() =>
  props.points.map((point, index) => {
    const limit = limits.value[index] ?? 0;
    const y = toY.value(point.value);
    return {
      key: `${point.week.year}-${point.week.week}`,
      x: toX.value(point.cycleWeek) - barWidth.value / 2,
      y,
      height: Math.max(0, plot.value.bottom - y),
      over: point.value > limit,
      label: `Week ${point.week.week}: ${point.value.toFixed(2)} against ${limit.toFixed(1)}`,
    };
  }),
);

/**
 * The limit as a stepped path. Each week holds its own value across its own
 * span, so the tightening shows as a wall rather than a slope.
 */
const limitPath = computed(() => {
  if (props.points.length === 0) return '';
  const half = barWidth.value / 2 + 1;
  const parts: string[] = [];

  props.points.forEach((point, index) => {
    const limit = limits.value[index] ?? 0;
    const y = toY.value(limit).toFixed(1);
    const left = (toX.value(point.cycleWeek) - half).toFixed(1);
    const right = (toX.value(point.cycleWeek) + half).toFixed(1);
    parts.push(`${index === 0 ? 'M' : 'L'}${left} ${y}`, `L${right} ${y}`);
  });

  return parts.join(' ');
});

const yTicks = computed(() => ticksFor(yExtent.value, 4));

/**
 * Week ticks are whole weeks. Letting the generic tick chooser near this axis
 * puts fractional ticks on a short span, which then all round to the same
 * label and the axis reads "w40 w40 w40".
 */
const xTicks = computed(() => {
  const first = Math.ceil(xExtent.value.min);
  const last = Math.floor(xExtent.value.max);
  const span = Math.max(1, last - first);
  const step = Math.max(1, Math.round(span / 6));

  const ticks: number[] = [];
  for (let week = first; week <= last; week += step) ticks.push(week);
  return ticks;
});
</script>

<template>
  <figure class="chart">
    <figcaption class="sr-only">{{ caption }}</figcaption>

    <div class="legend">
      <span class="entry"><span class="swatch bar" /> Adult female per fish</span>
      <span class="entry"><span class="swatch over" /> Over the limit</span>
      <span class="entry"><span class="swatch limit" /> Limit in force</span>
    </div>

    <p v-if="points.length === 0" class="empty">No counts filed for this pen</p>

    <svg
      v-else
      class="plot"
      :viewBox="`0 0 ${WIDTH} ${height}`"
      preserveAspectRatio="none"
      role="img"
      :aria-label="caption"
    >
      <g class="grid">
        <line
          v-for="tick in yTicks"
          :key="`grid-${tick}`"
          :x1="plot.left"
          :x2="plot.right"
          :y1="toY(tick)"
          :y2="toY(tick)"
        />
      </g>

      <ChartAxes
        :plot="plot"
        :x-ticks="xTicks"
        :y-ticks="yTicks"
        :to-x="toX"
        :to-y="toY"
        :format-x="(week: number) => `w${Math.round(week)}`"
        :format-y="(value: number) => value.toFixed(1)"
      />

      <rect
        v-for="bar in bars"
        :key="bar.key"
        class="bar"
        :class="{ over: bar.over }"
        :x="bar.x"
        :y="bar.y"
        :width="barWidth"
        :height="bar.height"
      >
        <title>{{ bar.label }}</title>
      </rect>

      <path class="limit" :d="limitPath" />
    </svg>
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
  width: 12px;
  height: 10px;
  border-radius: 1px;
}

.swatch.bar {
  background: v-bind('SERIES_COLOURS.biomass');
}

.swatch.over {
  background: v-bind('SERIES_COLOURS.adultFemale');
}

.swatch.limit {
  height: 0;
  border-top: 2px dashed v-bind('SERIES_COLOURS.licence');
}

.plot {
  width: 100%;
  height: auto;
  display: block;
}

.grid line {
  stroke: var(--rule-hair);
  stroke-dasharray: 2 4;
}

.axis text {
  font-family: var(--font-num);
  font-size: 10px;
  fill: var(--ink-muted);
}

rect.bar {
  fill: v-bind('SERIES_COLOURS.biomass');
}

rect.over {
  fill: v-bind('SERIES_COLOURS.adultFemale');
}

.limit {
  fill: none;
  stroke: v-bind('SERIES_COLOURS.licence');
  stroke-width: 1.6;
  stroke-dasharray: 7 4;
}

.empty {
  padding: var(--gap-6);
  text-align: center;
  color: var(--ink-muted);
  font-size: var(--type-sm);
  border: 1px dashed var(--rule-hair);
  border-radius: var(--radius-sm);
}
</style>

<script setup lang="ts">
import { computed, useId } from 'vue';

import ChartAxes from './ChartAxes.vue';
import { areaPath, linePath, type Point } from './path';
import {
  DEFAULT_MARGIN,
  extentOf,
  niceExtent,
  scaleLinear,
  SERIES_COLOURS,
  SERIES_DASH,
  ticksFor,
  weekTickStep,
} from './theme';

/**
 * Standing biomass against the licence.
 *
 * The chart exists to answer one question: which week does this site go over.
 * So the licence is a hard horizontal rule rather than another series, and
 * everything above it is shaded. The shading is the point. A line that crosses
 * another line reads as a crossing; a filled wedge above a ceiling reads as an
 * amount of fish that has to come off the site, which is what it is.
 *
 * Past and projected are drawn from the same series with the join marked,
 * because a reader who cannot see where the record stops and the model starts
 * will treat the model as record.
 */
export interface BiomassPoint {
  /** Weeks from now. Negative is record, zero is today, positive is model. */
  readonly weeksAhead: number;
  readonly biomassT: number;
}

const props = withDefaults(
  defineProps<{
    readonly points: readonly BiomassPoint[];
    readonly limitT: number;
    readonly caption: string;
    readonly height?: number;
  }>(),
  { height: 220 },
);

const WIDTH = 720;
const margin = DEFAULT_MARGIN;
const clipId = useId();

const plot = computed(() => ({
  left: margin.left,
  right: WIDTH - margin.right,
  top: margin.top,
  bottom: props.height - margin.bottom,
}));

const xExtent = computed(() =>
  niceExtent(extentOf(props.points.map((point) => point.weeksAhead)), { min: 0, max: 26 }),
);

/**
 * The licence is always inside the vertical extent, even on a site sitting at
 * half of it. A ceiling drawn off the top of the chart is a ceiling nobody can
 * judge the distance to.
 */
const yExtent = computed(() => {
  const values = props.points.map((point) => point.biomassT);
  const extent = extentOf([...values, props.limitT, 0]);
  return niceExtent(extent, { min: 0, max: props.limitT * 1.2 });
});

const toX = computed(() => scaleLinear(xExtent.value, plot.value.left, plot.value.right));
const toY = computed(() => scaleLinear(yExtent.value, plot.value.bottom, plot.value.top));

const projection = computed(() => ({ toX: toX.value, toY: toY.value }));

const yTicks = computed(() => ticksFor(yExtent.value, 5));

const xTicks = computed(() => {
  const step = weekTickStep(xExtent.value.max - xExtent.value.min);
  const ticks: number[] = [];
  for (
    let week = Math.ceil(xExtent.value.min / step) * step;
    week <= xExtent.value.max;
    week += step
  ) {
    ticks.push(week);
  }
  return ticks;
});

const recorded = computed<Point[]>(() =>
  props.points
    .filter((point) => point.weeksAhead <= 0)
    .map((point) => ({ x: point.weeksAhead, y: point.biomassT })),
);

const projected = computed<Point[]>(() => {
  // The projection starts at the last recorded point so the two meet rather
  // than leaving a gap at the join.
  const from = props.points.filter((point) => point.weeksAhead >= 0);
  const last = recorded.value[recorded.value.length - 1];
  const points = from.map((point) => ({ x: point.weeksAhead, y: point.biomassT }));
  return last !== undefined && points[0]?.x !== last.x ? [last, ...points] : points;
});

/** Only the stretch over the limit, so the shading has nothing below it. */
const overshoot = computed<Point[]>(() =>
  props.points.map((point) => ({
    x: point.weeksAhead,
    y: point.biomassT > props.limitT ? point.biomassT : null,
  })),
);

const breachAt = computed(() => {
  const point = props.points.find((candidate) => candidate.biomassT > props.limitT);
  return point?.weeksAhead ?? null;
});

const recordedPath = computed(() => linePath(recorded.value, projection.value));
const projectedPath = computed(() => linePath(projected.value, projection.value));
const overshootPath = computed(() => areaPath(overshoot.value, projection.value, props.limitT));
</script>

<template>
  <figure class="chart">
    <svg :viewBox="`0 0 ${WIDTH} ${height}`" role="img" :aria-label="caption">
      <defs>
        <clipPath :id="clipId">
          <rect
            :x="plot.left"
            :y="plot.top"
            :width="plot.right - plot.left"
            :height="plot.bottom - plot.top"
          />
        </clipPath>
      </defs>

      <ChartAxes
        :plot="plot"
        :x-ticks="xTicks"
        :y-ticks="yTicks"
        :to-x="toX"
        :to-y="toY"
        :format-x="(week: number) => (week === 0 ? 'now' : `${week > 0 ? '+' : ''}${week}`)"
        grid
      />

      <g :clip-path="`url(#${clipId})`">
        <path v-if="overshootPath" class="overshoot" :d="overshootPath" />
        <line class="limit" :x1="plot.left" :x2="plot.right" :y1="toY(limitT)" :y2="toY(limitT)" />
        <path class="recorded" :d="recordedPath" />
        <path class="projected" :d="projectedPath" />
        <line
          v-if="breachAt !== null"
          class="breach"
          :x1="toX(breachAt)"
          :x2="toX(breachAt)"
          :y1="plot.top"
          :y2="plot.bottom"
        />
      </g>

      <line class="today" :x1="toX(0)" :x2="toX(0)" :y1="plot.top" :y2="plot.bottom" />
      <text class="limitLabel" :x="plot.right - 4" :y="toY(limitT) - 5" text-anchor="end">
        Licence {{ limitT }} t
      </text>
    </svg>
    <figcaption>{{ caption }}</figcaption>
  </figure>
</template>

<style scoped>
svg {
  width: 100%;
  height: auto;
  font-family: var(--font-num);
  font-size: 11px;
}

.grid {
  stroke: v-bind('SERIES_COLOURS.grid');
  stroke-width: 1;
}

.axis text {
  fill: v-bind('SERIES_COLOURS.axis');
}

.recorded,
.projected {
  fill: none;
  stroke: v-bind('SERIES_COLOURS.biomass');
  stroke-width: 2;
  stroke-linejoin: round;
}

.projected {
  stroke-dasharray: 5 4;
}

.limit {
  stroke: v-bind('SERIES_COLOURS.licence');
  stroke-width: 1.5;
  stroke-dasharray: v-bind('SERIES_DASH.licence');
}

.limitLabel {
  fill: v-bind('SERIES_COLOURS.licence');
}

.overshoot {
  fill: v-bind('SERIES_COLOURS.licence');
  opacity: 0.18;
}

.breach {
  stroke: v-bind('SERIES_COLOURS.licence');
  stroke-width: 1;
  stroke-dasharray: 2 3;
}

.today {
  stroke: v-bind('SERIES_COLOURS.axis');
  stroke-width: 1;
}

figcaption {
  margin-top: var(--gap-2);
  color: var(--ink-muted);
  font-size: var(--type-xs);
}
</style>

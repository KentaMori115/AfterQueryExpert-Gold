<script setup lang="ts">
import { computed } from 'vue';

import { linePath, type Point } from './path';
import { extentOf, niceExtent, scaleLinear, SERIES_COLOURS, ticksFor } from './theme';

/**
 * Temperature and oxygen down the water column.
 *
 * Drawn with depth on the vertical axis running downwards, because that is how
 * the water actually is and because every profile the industry publishes is
 * drawn that way. Reading a profile upside down is a good way to mistake a
 * thermocline at five metres for one at fifteen, and the difference decides
 * whether the net gets lowered or lifted.
 *
 * Two quantities on one plot, so each gets its own horizontal scale and its
 * own axis. The axes are labelled at the ends rather than in a legend: on a
 * plot this small a legend takes more space than the labels it replaces.
 */
export interface ProfilePoint {
  readonly depthM: number;
  readonly temperatureC: number;
  readonly saturationPercent: number;
}

const props = withDefaults(
  defineProps<{
    readonly points: readonly ProfilePoint[];
    readonly caption: string;
    /** Depth of the net, drawn as the line the fish cannot go below. */
    readonly netDepthM?: number | null;
    readonly height?: number;
  }>(),
  { netDepthM: null, height: 240 },
);

const WIDTH = 360;
const MARGIN = { top: 26, right: 40, bottom: 30, left: 40 };

const plot = computed(() => ({
  left: MARGIN.left,
  right: WIDTH - MARGIN.right,
  top: MARGIN.top,
  bottom: props.height - MARGIN.bottom,
}));

const ordered = computed(() => props.points.slice().sort((a, b) => a.depthM - b.depthM));

const depthExtent = computed(() => {
  const deepest = Math.max(...ordered.value.map((point) => point.depthM), props.netDepthM ?? 0);
  return { min: 0, max: Number.isFinite(deepest) && deepest > 0 ? deepest : 15 };
});

const temperatureExtent = computed(() =>
  niceExtent(extentOf(ordered.value.map((point) => point.temperatureC)), { min: 4, max: 16 }),
);

const oxygenExtent = computed(() =>
  niceExtent(extentOf(ordered.value.map((point) => point.saturationPercent)), {
    min: 60,
    max: 110,
  }),
);

// Depth runs downwards, so top of the plot is the surface.
const toDepth = computed(() => scaleLinear(depthExtent.value, plot.value.top, plot.value.bottom));
const toTemperature = computed(() =>
  scaleLinear(temperatureExtent.value, plot.value.left, plot.value.right),
);
const toOxygen = computed(() => scaleLinear(oxygenExtent.value, plot.value.left, plot.value.right));

function seriesFor(read: (point: ProfilePoint) => number): Point[] {
  return ordered.value.map((point) => ({ x: point.depthM, y: read(point) }));
}

/** Depth is the shared axis, so both series project depth to y and value to x. */
const temperaturePath = computed(() =>
  linePath(
    seriesFor((point) => point.temperatureC),
    {
      toX: (depth) => toDepth.value(depth),
      toY: (value) => toTemperature.value(value),
    },
  ).replace(/([ML])(-?[\d.]+) (-?[\d.]+)/g, '$1$3 $2'),
);

const oxygenPath = computed(() =>
  linePath(
    seriesFor((point) => point.saturationPercent),
    {
      toX: (depth) => toDepth.value(depth),
      toY: (value) => toOxygen.value(value),
    },
  ).replace(/([ML])(-?[\d.]+) (-?[\d.]+)/g, '$1$3 $2'),
);

const depthTicks = computed(() => ticksFor(depthExtent.value, 4));
const temperatureTicks = computed(() => ticksFor(temperatureExtent.value, 3));

const stratification = computed(() => {
  const temperatures = ordered.value.map((point) => point.temperatureC);
  if (temperatures.length < 2) return null;
  return Math.max(...temperatures) - Math.min(...temperatures);
});
</script>

<template>
  <figure class="profile">
    <svg :viewBox="`0 0 ${WIDTH} ${height}`" role="img" :aria-label="caption">
      <g class="axis">
        <g v-for="tick in depthTicks" :key="`d${tick}`">
          <line
            :x1="plot.left"
            :x2="plot.right"
            :y1="toDepth(tick)"
            :y2="toDepth(tick)"
            class="grid"
          />
          <text :x="plot.left - 6" :y="toDepth(tick) + 4" text-anchor="end">{{ tick }}</text>
        </g>
        <text
          v-for="tick in temperatureTicks"
          :key="`t${tick}`"
          :x="toTemperature(tick)"
          :y="plot.top - 10"
          text-anchor="middle"
          class="temperatureTick"
        >
          {{ tick }}
        </text>
        <text :x="plot.left - 6" :y="plot.top - 10" text-anchor="end" class="unit">m</text>
        <text :x="plot.right" :y="plot.bottom + 20" text-anchor="end" class="unit">
          O2 {{ oxygenExtent.min }} to {{ oxygenExtent.max }} %
        </text>
      </g>

      <line
        v-if="netDepthM !== null"
        class="net"
        :x1="plot.left"
        :x2="plot.right"
        :y1="toDepth(netDepthM)"
        :y2="toDepth(netDepthM)"
      />

      <path class="oxygen" :d="oxygenPath" />
      <path class="temperature" :d="temperaturePath" />

      <g class="marks">
        <circle
          v-for="point in ordered"
          :key="`m${point.depthM}`"
          :cx="toTemperature(point.temperatureC)"
          :cy="toDepth(point.depthM)"
          r="2.5"
          class="temperatureMark"
        >
          <title>
            {{ point.depthM }} m: {{ point.temperatureC.toFixed(1) }} C,
            {{ point.saturationPercent.toFixed(0) }} % saturation
          </title>
        </circle>
      </g>
    </svg>
    <figcaption>
      {{ caption }}
      <span v-if="stratification !== null" class="strat">
        Stratified {{ stratification.toFixed(1) }} C top to bottom.
      </span>
    </figcaption>
  </figure>
</template>

<style scoped>
svg {
  width: 100%;
  height: auto;
  font-family: var(--font-num);
  font-size: 10px;
}

.grid {
  stroke: v-bind('SERIES_COLOURS.grid');
}

.axis text {
  fill: v-bind('SERIES_COLOURS.axis');
}

.temperatureTick {
  fill: v-bind('SERIES_COLOURS.temperature');
}

.temperature,
.oxygen {
  fill: none;
  stroke-width: 2;
  stroke-linejoin: round;
}

.temperature {
  stroke: v-bind('SERIES_COLOURS.temperature');
}

.oxygen {
  stroke: v-bind('SERIES_COLOURS.oxygen');
  stroke-dasharray: 4 3;
}

.temperatureMark {
  fill: v-bind('SERIES_COLOURS.temperature');
}

.net {
  stroke: v-bind('SERIES_COLOURS.axis');
  stroke-width: 1;
  stroke-dasharray: 2 4;
}

figcaption {
  margin-top: var(--gap-2);
  color: var(--ink-muted);
  font-size: var(--type-xs);
}

.strat {
  display: block;
}
</style>

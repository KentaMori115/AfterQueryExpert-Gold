<script setup lang="ts">
import { computed } from 'vue';

import type { OxygenReading } from '@/data/fixtures/environment';
import { oxygenBand, OXYGEN_BAND_LABELS } from '@/domain/water/oxygen';
import BaseBadge from '@/ui/BaseBadge.vue';
import BasePanel from '@/ui/BasePanel.vue';
import TraceChart, { type TraceSeries } from '@/ui/charts/TraceChart.vue';
import { formatDateTime, formatNumber, formatPercent, MISSING } from '@/ui/format';
import HeadlineFigure from '@/ui/HeadlineFigure.vue';
import { toneForOxygen } from '@/ui/tones';

/**
 * Oxygen through the day.
 *
 * The figure that matters is not the latest reading but the low: saturation
 * falls through the afternoon as the fish digest and the tide slackens, and a
 * pen that touched 58 per cent at four o'clock had a bad day whatever the
 * probe says at six. So the low is a headline of its own, with the time it
 * happened, and the feeding thresholds are drawn on the trace rather than
 * described in a caption.
 */
const props = defineProps<{
  readonly readings: readonly OxygenReading[];
  readonly loading?: boolean;
}>();

/** Below this the ration is cut; below the lower one it stops. */
const REDUCED_AT = 70;
const HOLD_AT = 60;

const ordered = computed(() => props.readings.slice().sort((a, b) => a.at - b.at));

const latest = computed(() => ordered.value.at(-1) ?? null);

const low = computed(() => {
  if (ordered.value.length === 0) return null;
  return ordered.value.reduce((worst, reading) =>
    reading.saturationPercent < worst.saturationPercent ? reading : worst,
  );
});

const band = computed(() => oxygenBand(latest.value?.saturationPercent ?? Number.NaN));

const series = computed<TraceSeries[]>(() => [
  {
    key: 'oxygen',
    label: 'Saturation',
    points: ordered.value.map((reading) => ({ x: reading.at, y: reading.saturationPercent })),
  },
]);

const timeOfDay = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

function formatClock(instant: number): string {
  return timeOfDay.format(new Date(instant));
}

const hoursBelow = computed(() => {
  if (ordered.value.length < 2) return 0;
  let ms = 0;
  for (let index = 1; index < ordered.value.length; index += 1) {
    const previous = ordered.value[index - 1]!;
    const current = ordered.value[index]!;
    if (previous.saturationPercent < REDUCED_AT) ms += current.at - previous.at;
  }
  return ms / 3_600_000;
});
</script>

<template>
  <BasePanel
    title="Oxygen"
    :subtitle="latest === null ? 'No readings' : `Last read ${formatDateTime(latest.at)}`"
    :tone="band === 'critical' || band === 'low' ? 'alarm' : band === 'good' ? 'plain' : 'caution'"
  >
    <p v-if="loading" class="waiting">Fetching the probe record.</p>

    <p v-else-if="ordered.length === 0" class="waiting">
      No oxygen has been logged against this pen in the window. A pen without a probe record cannot
      be fed to table with any confidence.
    </p>

    <template v-else>
      <div class="headline">
        <HeadlineFigure :value="formatPercent(latest?.saturationPercent, 0)" label="now" />
        <HeadlineFigure
          :value="formatPercent(low?.saturationPercent, 0)"
          :label="`low, at ${low === null ? MISSING : formatClock(low.at)}`"
          muted
        />
        <BaseBadge :tone="toneForOxygen(band)" solid dot>{{ OXYGEN_BAND_LABELS[band] }}</BaseBadge>
      </div>

      <dl class="detail">
        <div>
          <dt>Dissolved</dt>
          <dd>{{ formatNumber(latest?.oxygenMgL, 2) }} mg/l</dd>
        </div>
        <div>
          <dt>Temperature</dt>
          <dd>{{ formatNumber(latest?.temperatureC, 1) }} C</dd>
        </div>
        <div>
          <dt>Salinity</dt>
          <dd>{{ formatNumber(latest?.salinityPsu, 1) }} PSU</dd>
        </div>
        <div>
          <dt>Depth</dt>
          <dd>{{ formatNumber(latest?.depthM, 0) }} m</dd>
        </div>
      </dl>

      <p v-if="hoursBelow > 0" class="below">
        Spent {{ formatNumber(hoursBelow, 1) }} hours under {{ REDUCED_AT }} per cent, where the
        ration has to come down.
      </p>

      <TraceChart
        :series="series"
        caption="Saturation through the window, with the feeding thresholds"
        y-label="%"
        :references="[
          { value: REDUCED_AT, label: 'Cut ration', key: 'oxygenLow' },
          { value: HOLD_AT, label: 'Hold feed', key: 'oxygenLow' },
        ]"
        :format-x="formatClock"
      />
    </template>
  </BasePanel>
</template>

<style scoped>
.headline {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--gap-5);
}

.detail {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-5);
  margin: var(--gap-4) 0 0;
}

dt {
  color: var(--ink-muted);
  font-size: var(--type-xs);
}

dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.below,
.waiting {
  margin: var(--gap-3) 0 0;
  color: var(--ink-muted);
  font-size: var(--type-sm);
}
</style>

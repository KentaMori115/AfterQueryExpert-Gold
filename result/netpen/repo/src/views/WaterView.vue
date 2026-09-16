<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { useClock } from '@/app/clock';
import { useOxygen, usePenBoard, useTemperatures } from '@/app/queries';
import { addDays } from '@/domain/time/duration';
import { LOGGED_DEPTHS_M, REFERENCE_DEPTH_M } from '@/domain/units/water';
import BasePanel from '@/ui/BasePanel.vue';
import DepthProfile, { type ProfilePoint } from '@/ui/charts/DepthProfile.vue';
import TraceChart, { type TraceSeries } from '@/ui/charts/TraceChart.vue';
import { formatDate, formatNumber } from '@/ui/format';
import QueryState from '@/ui/QueryState.vue';

import PageHeader from './PageHeader.vue';
import { isStocked } from './pens/board';
import OxygenPanel from './water/OxygenPanel.vue';

/**
 * The water.
 *
 * Oxygen belongs to a pen and temperature belongs to the site, so the screen
 * is split that way rather than pretending both are site figures. The pen
 * picker only offers pens with fish in them: a probe record on an empty pen is
 * real data and nobody is going to make a decision on it.
 *
 * The window is a choice of days rather than a date range picker. Nobody on a
 * barge has ever wanted to see the sixth of March in particular; they want the
 * last day, the last week or the last month.
 */
const WINDOWS = [
  { days: 1, label: 'Last day' },
  { days: 7, label: 'Last week' },
  { days: 30, label: 'Last month' },
] as const;

const { now } = useClock();
const board = usePenBoard();
const temperatures = useTemperatures(REFERENCE_DEPTH_M);
const DEEP_DEPTH_M = LOGGED_DEPTHS_M[LOGGED_DEPTHS_M.length - 1] ?? REFERENCE_DEPTH_M;
const deepTemperatures = useTemperatures(DEEP_DEPTH_M);

const windowDays = ref<number>(1);
const penId = ref<string | null>(null);

const stockedPens = computed(() =>
  (board.data.value ?? []).map((row) => row.view).filter(isStocked),
);

// Land on the first stocked pen rather than an empty picker.
watch(stockedPens, (pens) => {
  if (penId.value === null && pens.length > 0) penId.value = String(pens[0]!.pen.id);
});

const from = computed(() => addDays(now.value, -windowDays.value));
const oxygen = useOxygen(penId, from, now);

const chosen = computed(
  () => stockedPens.value.find((view) => String(view.pen.id) === penId.value) ?? null,
);

/**
 * The profile is built from the most recent reading at each logged depth,
 * which is not the same as the readings from one cast: probes at different
 * depths report on their own schedules.
 */
const profile = computed<ProfilePoint[]>(() => {
  const readings = oxygen.data.value ?? [];
  const byDepth = new Map<number, ProfilePoint>();

  for (const reading of [...readings].sort((a, b) => a.at - b.at)) {
    byDepth.set(reading.depthM, {
      depthM: reading.depthM,
      temperatureC: reading.temperatureC,
      saturationPercent: reading.saturationPercent,
    });
  }
  return [...byDepth.values()].sort((a, b) => a.depthM - b.depthM);
});

const temperatureSeries = computed<TraceSeries[]>(() => [
  {
    key: 'temperature',
    label: `${REFERENCE_DEPTH_M} m`,
    points: (temperatures.data.value ?? []).map((sample) => ({
      x: sample.at,
      y: sample.meanC,
    })),
  },
  {
    key: 'temperatureDeep',
    label: `${DEEP_DEPTH_M} m`,
    points: (deepTemperatures.data.value ?? []).map((sample) => ({
      x: sample.at,
      y: sample.meanC,
    })),
  },
]);

const latestTemperature = computed(() => (temperatures.data.value ?? []).at(-1) ?? null);
</script>

<template>
  <section class="water">
    <PageHeader title="Water">
      <template #actions>
        <div class="controls">
          <label>
            Pen
            <select v-model="penId" class="control">
              <option
                v-for="view in stockedPens"
                :key="String(view.pen.id)"
                :value="String(view.pen.id)"
              >
                Pen {{ view.pen.number }}
              </option>
            </select>
          </label>
          <label>
            Window
            <select v-model.number="windowDays" class="control">
              <option v-for="option in WINDOWS" :key="option.days" :value="option.days">
                {{ option.label }}
              </option>
            </select>
          </label>
        </div>
      </template>
    </PageHeader>

    <QueryState
      :loading="board.isPending.value"
      :error="board.error.value"
      :data="board.data.value"
      :is-empty="() => stockedPens.length === 0"
      empty-title="Nothing in the water"
      empty-body="Every pen on this site is empty, so there is no probe record to read."
      :skeleton-lines="5"
      @retry="board.refetch()"
    >
      <div class="columns">
        <OxygenPanel :readings="oxygen.data.value ?? []" :loading="oxygen.isPending.value" />

        <BasePanel
          title="Water column"
          :subtitle="chosen === null ? undefined : `Pen ${chosen.pen.number}, latest at each depth`"
        >
          <DepthProfile
            v-if="profile.length > 1"
            :points="profile"
            :net-depth-m="chosen?.pen.geometry.depthM ?? null"
            caption="Temperature and oxygen down the column"
          />
          <p v-else class="thin">
            Only one depth has reported in this window, which is not a profile.
          </p>
        </BasePanel>
      </div>

      <BasePanel
        title="Sea temperature"
        :subtitle="
          latestTemperature === null
            ? undefined
            : `${formatNumber(latestTemperature.meanC, 1)} C at ${REFERENCE_DEPTH_M} m on ${formatDate(latestTemperature.at)}`
        "
      >
        <TraceChart
          :series="temperatureSeries"
          caption="Sea temperature at two depths through the cycle"
          y-label="C"
          :format-x="(value: number) => formatDate(value)"
        />
        <p class="thin">
          Growth is driven by the shallower figure, since that is where the fish spend the day. The
          deeper trace is here because the gap between them is what tells you the column is
          stratified, and a stratified column is one the fish can be squeezed in.
        </p>
      </BasePanel>
    </QueryState>
  </section>
</template>

<style scoped>
.water {
  display: flex;
  flex-direction: column;
  gap: var(--gap-4);
}

.controls {
  display: flex;
  gap: var(--gap-4);
}

label {
  display: flex;
  align-items: center;
  gap: var(--gap-2);
  color: var(--ink-secondary);
  font-size: var(--type-sm);
}

.columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--gap-4);
  align-items: start;
}

.thin {
  margin: var(--gap-3) 0 0;
  color: var(--ink-muted);
  font-size: var(--type-sm);
}
</style>

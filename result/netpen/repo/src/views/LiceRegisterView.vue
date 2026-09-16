<script setup lang="ts">
import { computed, ref } from 'vue';

import { useClock } from '@/app/clock';
import { useSite, useSiteView } from '@/app/queries';
import type { SiteView } from '@/data/projections/site';
import { limitFor } from '@/domain/lice/thresholds';
import { isoWeekOf } from '@/domain/time/duration';
import BasePanel from '@/ui/BasePanel.vue';
import LiceChart, { type WeeklyPoint } from '@/ui/charts/LiceChart.vue';
import { downloadCsv, exportName, toCsv, type CsvColumn } from '@/ui/csv';
import { formatDate, formatNumber, MISSING } from '@/ui/format';
import QueryState from '@/ui/QueryState.vue';
import StatStrip from '@/ui/StatStrip.vue';
import StatTile from '@/ui/StatTile.vue';
import { toneForUtilisation } from '@/ui/tones';

import RecordCountDialog from './lice/RecordCountDialog.vue';
import RegisterTable from './lice/RegisterTable.vue';
import PageHeader from './PageHeader.vue';
import { countIsOverdue, daysSinceCount, isStocked } from './pens/board';

/**
 * The lice register.
 *
 * This is the screen an inspector is shown, so it is built to be read by
 * somebody who did not write it: the site figure, the limit that applies this
 * week, the pens that are over, the pens nobody has counted, and then the
 * table. The site average is weighted by the fish in each pen, which is what
 * the regime asks for and is not the same as the mean of the pen figures.
 */
const { now } = useClock();
const site = useSite();
const siteView = useSiteView();

const openFor = ref<string | null>(null);

const regime = computed(() => site.data.value?.regime ?? 'norway');
const limit = computed(() => limitFor(regime.value, isoWeekOf(now.value)));

const pens = computed(() => siteView.data.value?.pens ?? []);

const openPen = computed(() => pens.value.find((view) => String(view.pen.id) === openFor.value));

const overLimit = computed(
  () => pens.value.filter((view) => (view.lice.averages?.adultFemale ?? 0) > limit.value).length,
);

const overdue = computed(() => pens.value.filter((view) => countIsOverdue(view, now.value)).length);

const dueTreatment = computed(() => pens.value.filter((view) => view.lice.obligation.required));

/**
 * The register as the inspector asks for it: one row per pen, every figure
 * that was on the screen, and the limit each count was judged against rather
 * than the one in force today.
 */
const exportColumns: CsvColumn<(typeof pens.value)[number]>[] = [
  { header: 'Pen', value: (view) => view.pen.number },
  // Blank rather than an em dash: the dash is a screen convention, and a
  // spreadsheet reading it back gets text where it wanted a date.
  {
    header: 'Counted at',
    value: (view) => (view.lice.latest === null ? '' : formatDate(view.lice.latest.countedAt)),
  },
  { header: 'Counted by', value: (view) => view.lice.latest?.countedBy ?? '' },
  { header: 'Fish examined', value: (view) => view.lice.latest?.sample.length ?? 0 },
  { header: 'Adult female', value: (view) => view.lice.averages?.adultFemale.toFixed(2) ?? '' },
  { header: 'Mobile', value: (view) => view.lice.averages?.mobile.toFixed(2) ?? '' },
  { header: 'Chalimus', value: (view) => view.lice.averages?.chalimus.toFixed(2) ?? '' },
  {
    header: 'Limit that week',
    value: (view) =>
      view.lice.latest === null
        ? ''
        : limitFor(regime.value, isoWeekOf(view.lice.latest.countedAt)).toFixed(2),
  },
  { header: 'Status', value: (view) => (view.lice.latest === null ? '' : view.lice.status) },
  {
    header: 'Days since count',
    value: (view) => {
      const days = daysSinceCount(view, now.value);
      return days === null ? '' : Math.floor(days);
    },
  },
  { header: 'Note', value: (view) => view.lice.latest?.note ?? '' },
];

function exportRegister(): void {
  const code = site.data.value?.code ?? 'site';
  downloadCsv({
    filename: exportName('lice register', code, now.value),
    content: toCsv(pens.value, exportColumns),
  });
}

/** The site figure by week, so the trend is on the same screen as the table. */
const trend = computed<WeeklyPoint[]>(() => {
  const weeks = new Map<string, { week: WeeklyPoint['week']; total: number; fish: number }>();

  for (const view of pens.value) {
    if (!isStocked(view)) continue;
    const fish = view.position?.count ?? 0;

    for (const entry of view.lice.weekly) {
      const key = `${entry.week.year}-${entry.week.week}`;
      const running = weeks.get(key) ?? { week: entry.week, total: 0, fish: 0 };
      weeks.set(key, {
        week: entry.week,
        total: running.total + entry.adultFemale * fish,
        fish: running.fish + fish,
      });
    }
  }

  return [...weeks.values()]
    .sort((a, b) => a.week.year - b.week.year || a.week.week - b.week.week)
    .map((entry, index) => ({
      week: entry.week,
      value: entry.fish === 0 ? 0 : entry.total / entry.fish,
      cycleWeek: index + 1,
    }));
});
</script>

<template>
  <section class="register">
    <PageHeader title="Lice register">
      <template #note>
        <p class="note">
          Every count filed against this site, pen by pen. The limit this week is
          {{ formatNumber(limit, 2) }} adult female per fish.
        </p>
      </template>
      <template #actions>
        <button
          type="button"
          class="control-button export"
          :disabled="pens.length === 0"
          @click="exportRegister"
        >
          Export as a spreadsheet
        </button>
      </template>
    </PageHeader>

    <QueryState
      :loading="siteView.isPending.value"
      :error="siteView.error.value"
      :data="siteView.data.value"
      :skeleton-lines="6"
      @retry="siteView.refetch()"
    >
      <template #default="{ data }: { data: SiteView }">
        <StatStrip>
          <StatTile
            label="Site average"
            :value="data.siteLiceAverage === null ? MISSING : formatNumber(data.siteLiceAverage, 2)"
            unit="AF"
            :tone="toneForUtilisation((data.siteLiceAverage ?? 0) / limit)"
            detail="Weighted by the fish in each pen"
          />
          <StatTile
            label="Pens over the limit"
            :value="String(overLimit)"
            :tone="overLimit === 0 ? 'good' : 'bad'"
            :detail="`Against ${formatNumber(limit, 2)} this week`"
          />
          <StatTile
            label="Counts overdue"
            :value="String(overdue)"
            :tone="overdue === 0 ? 'good' : 'caution'"
            detail="An uncounted pen reads as a breach"
          />
          <StatTile
            label="Treatment due"
            :value="String(dueTreatment.length)"
            :tone="dueTreatment.length === 0 ? 'good' : 'caution'"
            :detail="
              dueTreatment.length === 0
                ? 'Nothing outstanding'
                : `Pens ${dueTreatment.map((view) => view.pen.number).join(', ')}`
            "
          />
        </StatStrip>

        <BasePanel tight>
          <RegisterTable :pens="data.pens" :regime="regime" :now="now" @count="openFor = $event" />
        </BasePanel>

        <BasePanel v-if="trend.length > 1" title="Site figure by week">
          <LiceChart
            :points="trend"
            :regime="regime"
            caption="Weighted site average, adult female per fish"
          />
        </BasePanel>
      </template>
    </QueryState>

    <RecordCountDialog
      v-if="openPen !== undefined"
      :open="openFor !== null"
      :pen-id="openFor ?? ''"
      :pen-number="openPen.pen.number"
      @close="openFor = null"
      @filed="siteView.refetch()"
    />
  </section>
</template>

<style scoped>
.register {
  display: flex;
  flex-direction: column;
  gap: var(--gap-4);
}

.note {
  margin: var(--gap-1) 0 0;
  max-width: 70ch;
  color: var(--ink-muted);
  font-size: var(--type-sm);
}
</style>

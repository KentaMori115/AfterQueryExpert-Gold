<script setup lang="ts">
import { computed } from 'vue';

import type { PenView } from '@/data/projections/pen';
import {
  estimateHarvest,
  formatShare,
  GRADE_LABELS,
  type GradePressures,
} from '@/domain/harvest/grading';
import BaseBadge from '@/ui/BaseBadge.vue';
import BasePanel from '@/ui/BasePanel.vue';
import DataTable, { type Column } from '@/ui/DataTable.vue';
import { formatNumber, formatPercent, MISSING, pluralise } from '@/ui/format';

import { isStocked } from '../pens/board';

/**
 * Which pens come off, and what comes out of them.
 *
 * The order is the whole content of the panel. A site over its licence has to
 * take fish off, and the pen it takes them off is not the biggest one: it is
 * the one where the fish are furthest through the size bands and where nothing
 * is blocking the well boat. A pen inside a medicinal withdrawal cannot be
 * harvested at all, so it is listed and struck out rather than quietly left
 * off, which is the difference between a plan and a surprise on the day.
 */
const props = defineProps<{
  readonly pens: readonly PenView[];
  readonly requiredT: number;
  readonly weeksToBreach: number | null;
}>();

/**
 * Spread and condition are site figures rather than per pen: nobody weighs
 * enough fish per pen to fit a distribution, so the sampled site values are
 * carried across. Stated here rather than buried, because it is an assumption
 * the tonnage rests on.
 */
const SITE_CV_PERCENT = 14;
const SITE_CONDITION_FACTOR = 1.16;

interface Row {
  readonly penId: string;
  readonly number: number;
  readonly count: number;
  readonly meanWeightG: number;
  readonly liveTonnes: number;
  readonly guttedTonnes: number;
  readonly superior: number;
  readonly modal: string;
  readonly blocked: boolean;
  readonly blockedFor: number | null;
}

function pressuresFor(view: PenView): GradePressures {
  // Mortality that came off wounds shows up as downgrade at the factory, so
  // the pen's own mortality level stands in for the wound rate.
  const wounded =
    view.mortalityLevel === 'incident' ? 0.14 : view.mortalityLevel === 'elevated' ? 0.07 : 0.02;
  return { wounded, maturing: 0.03, deformed: 0.01 };
}

const rows = computed<Row[]>(() =>
  props.pens.filter(isStocked).map((view) => {
    const position = view.position!;
    const estimate = estimateHarvest(
      position.count,
      position.meanWeightG,
      SITE_CV_PERCENT,
      SITE_CONDITION_FACTOR,
      pressuresFor(view),
    );

    return {
      penId: String(view.pen.id),
      number: view.pen.number,
      count: position.count,
      meanWeightG: position.meanWeightG,
      liveTonnes: estimate.liveTonnes,
      guttedTonnes: estimate.guttedTonnes,
      superior: estimate.grades.superior,
      modal: estimate.modal?.label ?? MISSING,
      blocked: view.blocking !== null,
      blockedFor:
        view.withdrawal === null || view.withdrawal.cleared ? null : view.withdrawal.remaining,
    };
  }),
);

/** Heaviest fish first among the pens that can actually go. */
const ordered = computed(() =>
  rows.value.slice().sort((a, b) => {
    if (a.blocked !== b.blocked) return a.blocked ? 1 : -1;
    return b.meanWeightG - a.meanWeightG;
  }),
);

/** Pens taken in order until the required tonnage is covered. */
const chosen = computed(() => {
  if (props.requiredT <= 0) return new Set<string>();
  const picked = new Set<string>();
  let running = 0;

  for (const row of ordered.value) {
    if (row.blocked || running >= props.requiredT) continue;
    picked.add(row.penId);
    running += row.liveTonnes;
  }
  return picked;
});

const availableT = computed(() =>
  ordered.value.filter((row) => !row.blocked).reduce((total, row) => total + row.liveTonnes, 0),
);

const short = computed(() => props.requiredT > availableT.value);

const columns: readonly Column<Row>[] = [
  { key: 'pen', header: 'Pen', sortValue: (row) => row.number, width: '5rem' },
  { key: 'mean', header: 'Mean weight', numeric: true, sortValue: (row) => row.meanWeightG },
  { key: 'modal', header: 'Modal band' },
  { key: 'live', header: 'Live', numeric: true, sortValue: (row) => row.liveTonnes },
  { key: 'gutted', header: 'Gutted', numeric: true, sortValue: (row) => row.guttedTonnes },
  { key: 'superior', header: GRADE_LABELS.superior, numeric: true },
  { key: 'state', header: 'State' },
];
</script>

<template>
  <BasePanel
    title="Harvest plan"
    :subtitle="
      weeksToBreach === null
        ? 'Inside the licence for as far as the projection runs'
        : `Licence reached in ${pluralise(weeksToBreach, 'week')}`
    "
    :tone="short ? 'alarm' : requiredT > 0 ? 'caution' : 'plain'"
    tight
  >
    <p class="lead">
      <template v-if="requiredT <= 0">
        Nothing has to come off to stay inside the licence.
      </template>
      <template v-else>
        {{ formatNumber(requiredT, 0) }} t has to come off. The pens below are taken heaviest first,
        skipping anything inside a withdrawal.
      </template>
    </p>

    <p v-if="short" class="short" role="alert">
      Only {{ formatNumber(availableT, 0) }} t can be taken at the moment, which is short of what
      the licence needs. Something has to give: a withdrawal has to run out, or fish have to be
      moved off the site.
    </p>

    <DataTable
      :columns="columns"
      :rows="ordered"
      :row-key="(row: Row) => row.penId"
      caption="Pens by harvest order, heaviest fish first"
      empty-message="Nothing standing on this site."
      :is-selected="(row: Row) => chosen.has(row.penId)"
      compact
    >
      <template #cell-pen="{ row }">
        <RouterLink :to="`/pens/${row.penId}`">Pen {{ row.number }}</RouterLink>
      </template>
      <template #cell-mean="{ row }">{{ formatNumber(row.meanWeightG / 1000, 2) }} kg</template>
      <template #cell-modal="{ row }">{{ row.modal }}</template>
      <template #cell-live="{ row }">{{ formatNumber(row.liveTonnes, 1) }} t</template>
      <template #cell-gutted="{ row }">{{ formatNumber(row.guttedTonnes, 1) }} t</template>
      <template #cell-superior="{ row }">{{ formatShare(row.superior) }}</template>
      <template #cell-state="{ row }">
        <BaseBadge v-if="row.blocked" tone="bad" dot title="Inside a medicinal withdrawal">
          Blocked
        </BaseBadge>
        <BaseBadge v-else-if="chosen.has(row.penId)" tone="info" solid>Take</BaseBadge>
        <span v-else class="hold">Hold</span>
      </template>
    </DataTable>

    <p v-if="rows.some((row) => row.blockedFor !== null)" class="foot">
      <template v-for="row in rows" :key="row.penId">
        <span v-if="row.blockedFor !== null" class="blockedNote">
          Pen {{ row.number }} clears its withdrawal in {{ formatNumber(row.blockedFor, 0) }} degree
          days.
        </span>
      </template>
    </p>

    <p class="assumption">
      Sizes are spread at {{ formatPercent(SITE_CV_PERCENT, 0) }} coefficient of variation on a
      condition factor of {{ formatNumber(SITE_CONDITION_FACTOR, 2) }}, both sampled across the site
      rather than measured pen by pen.
    </p>
  </BasePanel>
</template>

<style scoped>
.lead,
.short,
.foot,
.assumption {
  margin: 0;
  padding: var(--gap-3) var(--gap-4);
  font-size: var(--type-sm);
}

.short {
  color: var(--fault);
}

.assumption {
  color: var(--ink-muted);
  font-size: var(--type-xs);
}

.foot {
  display: flex;
  flex-direction: column;
  gap: var(--gap-1);
  color: var(--ink-muted);
  font-size: var(--type-xs);
}

a {
  color: inherit;
}

.hold {
  color: var(--ink-muted);
  font-size: var(--type-xs);
}
</style>

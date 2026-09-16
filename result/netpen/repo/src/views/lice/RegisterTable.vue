<script setup lang="ts">
import { computed } from 'vue';

import type { PenView } from '@/data/projections/pen';
import { limitFor, type Regime } from '@/domain/lice/thresholds';
import { isoWeekOf } from '@/domain/time/duration';
import BaseBadge from '@/ui/BaseBadge.vue';
import DataTable, { type Column } from '@/ui/DataTable.vue';
import { formatDate, formatNumber, MISSING, pluralise } from '@/ui/format';
import { toneForLice } from '@/ui/tones';

import { COUNT_STALE_DAYS, daysSinceCount, isStocked } from '../pens/board';

/**
 * The register, as the auditor reads it.
 *
 * One row per pen, latest count, when it was taken and by whom, against the
 * limit that applied that week. The audit question is never "what is the site
 * average" but "show me pen 5, week 42", so the table carries the individual
 * counts and the site figure sits above it rather than replacing it.
 *
 * A pen with no count is a row, not a gap. That is the whole point of the
 * register: an uncounted pen is the thing an inspection finds.
 */
const props = defineProps<{
  readonly pens: readonly PenView[];
  readonly regime: Regime;
  readonly now: number;
}>();

const emit = defineEmits<{ count: [penId: string] }>();

interface Row {
  readonly penId: string;
  readonly number: number;
  readonly stocked: boolean;
  readonly adultFemale: number | null;
  readonly mobile: number | null;
  readonly countedAt: number | null;
  readonly countedBy: string | null;
  readonly limit: number;
  readonly overdueDays: number | null;
  readonly view: PenView;
}

const rows = computed<Row[]>(() =>
  props.pens.map((view) => {
    const latest = view.lice.latest;
    const days = daysSinceCount(view, props.now);

    return {
      penId: String(view.pen.id),
      number: view.pen.number,
      stocked: isStocked(view),
      adultFemale: view.lice.averages?.adultFemale ?? null,
      mobile: view.lice.averages?.mobile ?? null,
      countedAt: latest?.countedAt ?? null,
      countedBy: latest?.countedBy ?? null,
      limit: limitFor(props.regime, isoWeekOf(latest?.countedAt ?? props.now)),
      overdueDays: days !== null && days > COUNT_STALE_DAYS ? Math.floor(days) : null,
      view,
    };
  }),
);

const columns: readonly Column<Row>[] = [
  { key: 'pen', header: 'Pen', sortValue: (row) => row.number, width: '5rem' },
  {
    key: 'adultFemale',
    header: 'Adult female',
    numeric: true,
    sortValue: (row) => row.adultFemale ?? -1,
  },
  { key: 'mobile', header: 'Mobile', numeric: true, sortValue: (row) => row.mobile ?? -1 },
  { key: 'limit', header: 'Limit', numeric: true, width: '5rem' },
  { key: 'countedAt', header: 'Counted', sortValue: (row) => row.countedAt ?? 0 },
  { key: 'countedBy', header: 'By' },
  { key: 'status', header: 'Status' },
  { key: 'action', header: '', width: '7rem' },
];

function over(row: Row): boolean {
  return row.adultFemale !== null && row.adultFemale > row.limit;
}
</script>

<template>
  <DataTable
    :columns="columns"
    :rows="rows"
    :row-key="(row: Row) => row.penId"
    caption="Latest lice count for every pen on the site"
    empty-message="No pens on this licence."
    :initial-sort="{ key: 'pen', direction: 'asc' }"
  >
    <template #cell-pen="{ row }">
      <RouterLink :to="`/pens/${row.penId}`">Pen {{ row.number }}</RouterLink>
    </template>

    <template #cell-adultFemale="{ row }">
      <span :class="{ over: over(row) }">{{ formatNumber(row.adultFemale, 2) }}</span>
    </template>

    <template #cell-mobile="{ row }">{{ formatNumber(row.mobile, 2) }}</template>

    <template #cell-limit="{ row }">{{ formatNumber(row.limit, 2) }}</template>

    <template #cell-countedAt="{ row }">
      <span v-if="row.countedAt === null" class="never">Never</span>
      <span v-else :class="{ stale: row.overdueDays !== null }">
        {{ formatDate(row.countedAt) }}
        <span v-if="row.overdueDays !== null" class="ago">
          {{ pluralise(row.overdueDays, 'day') }} ago
        </span>
      </span>
    </template>

    <template #cell-countedBy="{ row }">{{ row.countedBy ?? MISSING }}</template>

    <template #cell-status="{ row }">
      <BaseBadge v-if="!row.stocked" tone="neutral">Empty</BaseBadge>
      <BaseBadge v-else :tone="toneForLice(row.view.lice.status)" dot>
        {{ row.view.lice.status.replace('-', ' ') }}
      </BaseBadge>
    </template>

    <template #cell-action="{ row }">
      <button
        v-if="row.stocked"
        type="button"
        class="control-button control-small"
        @click.stop="emit('count', row.penId)"
      >
        Count
      </button>
    </template>
  </DataTable>
</template>

<style scoped>
a {
  color: inherit;
}

.over {
  color: var(--fault);
  font-weight: 600;
}

.never,
.stale {
  color: var(--caution);
}

.ago {
  display: block;
  color: var(--ink-muted);
  font-size: var(--type-xs);
}
</style>

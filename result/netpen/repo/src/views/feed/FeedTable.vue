<script setup lang="ts">
import { computed } from 'vue';

import type { PenView } from '@/data/projections/pen';
import { CONSTRAINT_LABELS, type FeedConstraint } from '@/domain/feed/plan';
import { pelletSizeFor } from '@/domain/feed/table';
import BaseBadge from '@/ui/BaseBadge.vue';
import DataTable, { type Column } from '@/ui/DataTable.vue';
import { formatNumber, formatPercent, MISSING } from '@/ui/format';

import { isStocked } from '../pens/board';

/**
 * The day's feed, pen by pen.
 *
 * This is the sheet the barge operator works from, so it is a table and not a
 * set of cards: the useful reading is down a column, comparing what each pen
 * is getting, and the column that matters most is the one saying why a pen is
 * getting less than the table says it should.
 *
 * The silo column exists because a pellet size change means a silo change and
 * a barge visit, and finding out at seven in the morning that two pens have
 * moved up a size is how a feeding day gets lost.
 */
const props = defineProps<{
  readonly pens: readonly PenView[];
}>();

interface Row {
  readonly penId: string;
  readonly number: number;
  readonly biomassT: number;
  readonly meanWeightG: number;
  readonly pelletMm: number;
  readonly tableKg: number;
  readonly recommendedKg: number;
  readonly fraction: number;
  readonly binding: FeedConstraint;
  readonly ratePercent: number;
}

const rows = computed<Row[]>(() =>
  props.pens
    .filter((view) => isStocked(view) && view.feed !== null)
    .map((view) => {
      const plan = view.feed!;
      const position = view.position!;

      return {
        penId: String(view.pen.id),
        number: view.pen.number,
        biomassT: view.biomassKg / 1000,
        meanWeightG: position.meanWeightG,
        pelletMm: pelletSizeFor(position.meanWeightG),
        tableKg: plan.tableKg,
        recommendedKg: plan.recommendedKg,
        fraction: plan.fraction,
        binding: plan.binding,
        ratePercent: plan.ratePercent,
      };
    }),
);

const totals = computed(() => ({
  recommendedKg: rows.value.reduce((total, row) => total + row.recommendedKg, 0),
  tableKg: rows.value.reduce((total, row) => total + row.tableKg, 0),
  heldBack: rows.value.filter((row) => row.binding !== 'table').length,
}));

/** Distinct pellet sizes across the site, which is silos on the barge. */
const pelletSizes = computed(() =>
  [...new Set(rows.value.map((row) => row.pelletMm))].sort((a, b) => a - b),
);

const columns: readonly Column<Row>[] = [
  { key: 'pen', header: 'Pen', sortValue: (row) => row.number, width: '5rem' },
  { key: 'biomass', header: 'Biomass', numeric: true, sortValue: (row) => row.biomassT },
  {
    key: 'pellet',
    header: 'Pellet',
    numeric: true,
    sortValue: (row) => row.pelletMm,
    width: '5rem',
  },
  { key: 'table', header: 'To table', numeric: true, sortValue: (row) => row.tableKg },
  { key: 'ration', header: 'Ration', numeric: true, sortValue: (row) => row.recommendedKg },
  { key: 'rate', header: 'Rate', numeric: true, sortValue: (row) => row.ratePercent },
  { key: 'why', header: 'Why' },
];

function held(row: Row): boolean {
  return row.binding !== 'table';
}
</script>

<template>
  <div class="feed">
    <DataTable
      :columns="columns"
      :rows="rows"
      :row-key="(row: Row) => row.penId"
      caption="Today's ration for every stocked pen"
      empty-message="Nothing to feed. Every pen is empty, or no water reading has come in."
      :initial-sort="{ key: 'pen', direction: 'asc' }"
    >
      <template #cell-pen="{ row }">
        <RouterLink :to="`/pens/${row.penId}`">Pen {{ row.number }}</RouterLink>
      </template>
      <template #cell-biomass="{ row }">{{ formatNumber(row.biomassT, 1) }} t</template>
      <template #cell-pellet="{ row }">{{ formatNumber(row.pelletMm, 1) }} mm</template>
      <template #cell-table="{ row }">{{ formatNumber(row.tableKg, 0) }} kg</template>
      <template #cell-ration="{ row }">
        <span :class="{ held: held(row) }">{{ formatNumber(row.recommendedKg, 0) }} kg</span>
      </template>
      <template #cell-rate="{ row }">{{ formatNumber(row.ratePercent, 2) }} %</template>
      <template #cell-why="{ row }">
        <BaseBadge v-if="held(row)" tone="caution" dot>
          {{ CONSTRAINT_LABELS[row.binding] }}
        </BaseBadge>
        <span v-else class="clear">{{ MISSING }}</span>
      </template>
    </DataTable>

    <dl class="totals">
      <div>
        <dt>Loading today</dt>
        <dd>{{ formatNumber(totals.recommendedKg, 0) }} kg</dd>
      </div>
      <div>
        <dt>Against table</dt>
        <dd>
          {{ formatNumber(totals.tableKg, 0) }} kg,
          {{ formatPercent((totals.recommendedKg / (totals.tableKg || 1)) * 100, 0) }} of it
        </dd>
      </div>
      <div>
        <dt>Pens held back</dt>
        <dd :class="{ held: totals.heldBack > 0 }">{{ totals.heldBack }}</dd>
      </div>
      <div>
        <dt>Pellet sizes</dt>
        <dd>{{ pelletSizes.map((size) => `${size} mm`).join(', ') || MISSING }}</dd>
      </div>
    </dl>
  </div>
</template>

<style scoped>
.feed {
  display: flex;
  flex-direction: column;
}

a {
  color: inherit;
}

.held {
  color: var(--caution);
}

.clear {
  color: var(--ink-muted);
}

.totals {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-5);
  margin: 0;
  padding: var(--gap-3) var(--gap-4);
  border-top: 1px solid var(--rule-hair);
  background: var(--surface-sunken);
}

dt {
  color: var(--ink-muted);
  font-size: var(--type-xs);
}

dd {
  margin: 0;
  font-size: var(--type-sm);
  font-variant-numeric: tabular-nums;
}
</style>

<script setup lang="ts">
import { computed } from 'vue';

import type { PenView } from '@/data/projections/pen';
import { achievedEfficacy, profileFor, type TreatmentEvent } from '@/domain/health/treatment';
import BaseBadge from '@/ui/BaseBadge.vue';
import BasePanel from '@/ui/BasePanel.vue';
import DataTable, { type Column } from '@/ui/DataTable.vue';
import { formatDate, formatNumber, formatPercent, MISSING } from '@/ui/format';
import HeadlineFigure from '@/ui/HeadlineFigure.vue';
import { toneForMortality } from '@/ui/tones';

/**
 * Treatments and the withdrawal running off them.
 *
 * The withdrawal is the part with teeth. Harvesting inside it is a food safety
 * offence rather than a paperwork slip, so the remaining degree days are shown
 * as a figure and a bar, and the pen is marked as blocked rather than merely
 * described as recently treated.
 *
 * Efficacy is shown where both counts exist, because a method that is losing
 * its grip on a site shows up here first, one treatment at a time, long before
 * anybody runs a bioassay.
 */
const props = defineProps<{
  readonly view: PenView;
}>();

const emit = defineEmits<{ treat: []; mort: [] }>();

const withdrawal = computed(() => props.view.withdrawal);

const blocked = computed(() => props.view.blocking !== null);

const progress = computed(() => {
  const current = withdrawal.value;
  if (current === null || current.required <= 0) return 1;
  return Math.min(1, current.accumulated / current.required);
});

const columns: readonly Column<TreatmentEvent>[] = [
  { key: 'completedAt', header: 'Finished', sortValue: (row) => row.completedAt, width: '7rem' },
  { key: 'method', header: 'Method', sortValue: (row) => profileFor(row.method).label },
  { key: 'before', header: 'Before', numeric: true, width: '5rem' },
  { key: 'after', header: 'After', numeric: true, width: '5rem' },
  { key: 'efficacy', header: 'Reduction', numeric: true, width: '6rem' },
];

function efficacyOf(event: TreatmentEvent): string {
  const achieved = achievedEfficacy(event);
  return achieved === null ? MISSING : formatPercent(achieved * 100, 0);
}

function poor(event: TreatmentEvent): boolean {
  const achieved = achievedEfficacy(event);
  return achieved !== null && achieved < profileFor(event.method).typicalEfficacy - 0.2;
}
</script>

<template>
  <BasePanel title="Health" :tone="blocked ? 'caution' : 'plain'" tight>
    <div class="body">
      <div class="actions">
        <button type="button" class="control-button control-small" @click="emit('mort')">
          Record mortality
        </button>
        <button type="button" class="control-button control-small" @click="emit('treat')">
          Record a treatment
        </button>
      </div>

      <div class="mortality">
        <HeadlineFigure
          :value="formatPercent(view.cumulativeMortalityPercent, 2)"
          label="cumulative mortality"
        />
        <BaseBadge :tone="toneForMortality(view.mortalityLevel)" dot>
          {{ view.mortalityLevel }}
        </BaseBadge>
        <span class="daily">
          {{ formatPercent(view.dailyMortalityPercent, 3) }} a day over the last week
        </span>
      </div>

      <div v-if="withdrawal !== null" class="withdrawal" :class="{ blocked }">
        <div class="row">
          <span class="name">
            Withdrawal on {{ profileFor(view.treatments[0]!.method).label }}
          </span>
          <span v-if="withdrawal.cleared" class="cleared">Cleared</span>
          <span v-else class="remaining">
            {{ formatNumber(withdrawal.remaining, 0) }} degree days left
          </span>
        </div>
        <span class="track">
          <span class="level" :style="{ width: `${(progress * 100).toFixed(1)}%` }" />
        </span>
        <p v-if="blocked" class="warn">
          This pen cannot be harvested until the withdrawal is served.
        </p>
      </div>
    </div>

    <DataTable
      :columns="columns"
      :rows="view.treatments"
      :row-key="(row: TreatmentEvent) => row.id"
      caption="Treatments against this pen, most recent first"
      empty-message="No treatment has been given to this pen."
      compact
    >
      <template #cell-completedAt="{ row }">{{ formatDate(row.completedAt) }}</template>
      <template #cell-method="{ row }">
        {{ profileFor(row.method).label }}
        <span v-if="row.note" class="note">{{ row.note }}</span>
      </template>
      <template #cell-before="{ row }">{{ formatNumber(row.beforeCount, 2) }}</template>
      <template #cell-after="{ row }">{{ formatNumber(row.afterCount, 2) }}</template>
      <template #cell-efficacy="{ row }">
        <span :class="{ poor: poor(row) }">{{ efficacyOf(row) }}</span>
      </template>
    </DataTable>
  </BasePanel>
</template>

<style scoped>
.body {
  display: flex;
  flex-direction: column;
  gap: var(--gap-4);
  padding: var(--gap-4);
}

.mortality {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--gap-3);
}

.daily {
  color: var(--ink-muted);
  font-size: var(--type-sm);
}

.withdrawal {
  padding: var(--gap-3);
  border: 1px solid var(--rule-hair);
  border-radius: var(--radius-sm);
}

.withdrawal.blocked {
  border-color: var(--caution);
  background: var(--caution-wash);
}

.row {
  display: flex;
  justify-content: space-between;
  gap: var(--gap-3);
  margin-bottom: var(--gap-2);
  font-size: var(--type-sm);
}

.remaining {
  font-variant-numeric: tabular-nums;
}

.cleared {
  color: var(--pass);
}

.track {
  display: block;
  height: 4px;
  border-radius: 2px;
  background: var(--surface-sunken);
  overflow: hidden;
}

.level {
  display: block;
  height: 100%;
  background: var(--caution);
}

.warn {
  margin: var(--gap-2) 0 0;
  font-size: var(--type-xs);
}

.note {
  display: block;
  color: var(--ink-muted);
  font-size: var(--type-xs);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--gap-2);
  order: -1;
}

.poor {
  color: var(--fault);
}
</style>

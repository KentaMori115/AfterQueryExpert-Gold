<script setup lang="ts">
import { computed } from 'vue';

import { useClock } from '@/app/clock';
import { usePenBoard } from '@/app/queries';
import { BOARD_SORT_LABELS, usePreferences, type BoardSort } from '@/app/stores/preferences';
import type { PenBoardRow } from '@/data/api';
import BasePanel from '@/ui/BasePanel.vue';
import { formatInteger, formatNumber, MISSING } from '@/ui/format';
import QueryState from '@/ui/QueryState.vue';
import StatStrip from '@/ui/StatStrip.vue';
import StatTile from '@/ui/StatTile.vue';
import { toneForUtilisation } from '@/ui/tones';

import PageHeader from './PageHeader.vue';
import { isStocked, sortBoard, summarise } from './pens/board';
import PenCard from './pens/PenCard.vue';

/**
 * The pen board.
 *
 * Everything a manager needs before deciding where to send the boat, on one
 * screen with no scrolling on a barge monitor. The summary strip is the site
 * in five numbers; the cards below it are the pens in whatever order the
 * terminal was last left in.
 *
 * The order is a stored preference rather than local state on purpose. A
 * shared terminal that resets to pen number every morning is a terminal
 * everybody re-sorts every morning.
 */
const preferences = usePreferences();
const { now } = useClock();
const board = usePenBoard();

const rows = computed<readonly PenBoardRow[]>(() => board.data.value ?? []);

const shown = computed(() => {
  const visible = preferences.showEmptyPens
    ? rows.value
    : rows.value.filter((row) => isStocked(row.view));
  const ordered = sortBoard(
    visible.map((row) => row.view),
    preferences.boardSort,
    now.value,
  );
  const byPen = new Map(visible.map((row) => [String(row.view.pen.id), row]));
  return ordered.map((view) => byPen.get(String(view.pen.id))!);
});

const summary = computed(() =>
  summarise(
    rows.value.map((row) => row.view),
    now.value,
  ),
);

const openAlerts = computed(() => rows.value.reduce((total, row) => total + row.alerts.length, 0));

const sortOptions = Object.entries(BOARD_SORT_LABELS) as [BoardSort, string][];

function onSort(event: Event) {
  preferences.setBoardSort((event.target as HTMLSelectElement).value as BoardSort);
}
</script>

<template>
  <section class="board">
    <PageHeader title="Pens">
      <template #actions>
        <div class="right">
          <label class="toggle">
            <input
              type="checkbox"
              :checked="preferences.showEmptyPens"
              @change="preferences.setShowEmptyPens(($event.target as HTMLInputElement).checked)"
            />
            Show empty pens
          </label>
          <label class="sort">
            Order
            <select class="control" :value="preferences.boardSort" @change="onSort">
              <option v-for="[value, label] in sortOptions" :key="value" :value="value">
                {{ label }}
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
      :is-empty="(data: readonly PenBoardRow[]) => data.length === 0"
      empty-title="No pens on this site"
      empty-body="The licence has no pens registered against it yet."
      :skeleton-lines="6"
      @retry="board.refetch()"
    >
      <StatStrip>
        <StatTile
          label="Standing biomass"
          :value="formatNumber(summary.biomassT, 1)"
          unit="t"
          :detail="`${formatInteger(summary.fish)} fish in ${summary.stocked} pens`"
        />
        <StatTile
          label="Needs attention"
          :value="String(summary.needingAttention)"
          :unit="summary.needingAttention === 1 ? 'pen' : 'pens'"
          :tone="summary.needingAttention === 0 ? 'good' : 'caution'"
          detail="Scored on lice, oxygen, density and mortality"
        />
        <StatTile
          label="Worst lice"
          :value="summary.worstLice === null ? MISSING : formatNumber(summary.worstLice, 2)"
          unit="AF"
          :tone="toneForUtilisation((summary.worstLice ?? 0) / 0.5)"
          detail="Adult female, latest count in each pen"
        />
        <StatTile
          label="Counts overdue"
          :value="String(summary.overdueCounts)"
          :tone="summary.overdueCounts === 0 ? 'good' : 'caution'"
          detail="Pens without a count this week"
        />
        <StatTile
          label="Open alerts"
          :value="String(openAlerts)"
          :tone="openAlerts === 0 ? 'good' : 'caution'"
          detail="Unacknowledged across the site"
        />
      </StatStrip>

      <BasePanel tight>
        <div class="grid">
          <PenCard v-for="row in shown" :key="String(row.view.pen.id)" :view="row.view" />
        </div>
      </BasePanel>
    </QueryState>
  </section>
</template>

<style scoped>
.board {
  display: flex;
  flex-direction: column;
  gap: var(--gap-4);
}

.right {
  display: flex;
  align-items: center;
  gap: var(--gap-4);
}

.toggle,
.sort {
  display: flex;
  align-items: center;
  gap: var(--gap-2);
  color: var(--ink-secondary);
  font-size: var(--type-sm);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--gap-3);
  padding: var(--gap-3);
}
</style>

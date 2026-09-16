<script setup lang="ts">
import { computed, ref } from 'vue';

import { useClock } from '@/app/clock';
import { useAcknowledgeAlert, useAlerts, usePeople } from '@/app/queries';
import {
  byUrgency,
  isAcknowledged,
  isOpen,
  isRegulatory,
  needsAttention,
  type Alert,
} from '@/domain/alerts/types';
import BasePanel from '@/ui/BasePanel.vue';
import EmptyState from '@/ui/EmptyState.vue';
import { pluralise } from '@/ui/format';
import QueryState from '@/ui/QueryState.vue';
import StatStrip from '@/ui/StatStrip.vue';
import StatTile from '@/ui/StatTile.vue';

import AlertRow from './alerts/AlertRow.vue';
import PageHeader from './PageHeader.vue';

/**
 * Everything the site is being asked to look at.
 *
 * Sorted by urgency rather than by time, and the sort is not a preference. An
 * alert list ordered by when things happened puts a lice deadline expiring on
 * Friday underneath a net inspection raised this morning, which is exactly
 * backwards.
 *
 * Cleared alerts are hidden by default and kept rather than deleted, because
 * the question after an incident is always what the system knew and when, and
 * a list that quietly forgets cannot answer it.
 */
type Filter = 'attention' | 'open' | 'all';

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: 'attention', label: 'Needs somebody' },
  { value: 'open', label: 'Open' },
  { value: 'all', label: 'Everything raised' },
];

const { now } = useClock();
const alerts = useAlerts();
const people = usePeople();
const acknowledge = useAcknowledgeAlert();

const filter = ref<Filter>('attention');
const working = ref<string | null>(null);

const all = computed<readonly Alert[]>(() => alerts.data.value ?? []);

const shown = computed(() =>
  all.value
    .filter((alert) => {
      if (filter.value === 'all') return true;
      if (filter.value === 'open') return isOpen(alert);
      return needsAttention(alert);
    })
    .slice()
    .sort(byUrgency),
);

const counts = computed(() => ({
  urgent: all.value.filter((alert) => isOpen(alert) && alert.severity === 'urgent').length,
  regulatory: all.value.filter((alert) => isOpen(alert) && isRegulatory(alert.kind)).length,
  unclaimed: all.value.filter(needsAttention).length,
  acknowledged: all.value.filter((alert) => isOpen(alert) && isAcknowledged(alert)).length,
}));

/**
 * Whoever is at the terminal. In the field this comes from the login; the
 * demonstration build has no login, so it takes the site manager, and it is
 * worth being honest about that rather than writing "unknown" into a record
 * of who took a regulatory alert on.
 */
const actingAs = computed(() => people.data.value?.[0] ?? null);

async function take(alertId: string): Promise<void> {
  const person = actingAs.value;
  if (person === null) return;

  working.value = alertId;
  try {
    await acknowledge.mutateAsync({ alertId, personId: String(person.id) });
  } catch {
    // The row goes back to offering the button. Nothing was taken on, and the
    // list is the record of that rather than a toast that has already gone.
  } finally {
    working.value = null;
  }
}
</script>

<template>
  <section class="alerts">
    <PageHeader
      title="Alerts"
      note="Ordered by urgency, not by when they were raised. A deadline on Friday matters more
        than something that started an hour ago."
    >
      <template #actions>
        <div class="filters" role="group" aria-label="Which alerts to show">
          <button
            v-for="option in FILTERS"
            :key="option.value"
            type="button"
            :class="{ on: filter === option.value }"
            :aria-pressed="filter === option.value"
            @click="filter = option.value"
          >
            {{ option.label }}
          </button>
        </div>
      </template>
    </PageHeader>

    <QueryState
      :loading="alerts.isPending.value"
      :error="alerts.error.value"
      :data="alerts.data.value"
      :skeleton-lines="5"
      @retry="alerts.refetch()"
    >
      <StatStrip>
        <StatTile
          label="Urgent"
          :value="String(counts.urgent)"
          :tone="counts.urgent === 0 ? 'good' : 'bad'"
          detail="Open and marked urgent"
        />
        <StatTile
          label="Regulatory"
          :value="String(counts.regulatory)"
          :tone="counts.regulatory === 0 ? 'good' : 'caution'"
          detail="Carry an obligation outside the company"
        />
        <StatTile
          label="Nobody on them"
          :value="String(counts.unclaimed)"
          :tone="counts.unclaimed === 0 ? 'good' : 'caution'"
          detail="Open and not yet taken on"
        />
        <StatTile
          label="Taken on"
          :value="String(counts.acknowledged)"
          detail="Someone has them, still open"
        />
      </StatStrip>

      <BasePanel tight>
        <EmptyState
          v-if="shown.length === 0"
          title="Nothing to look at"
          :body="
            filter === 'attention'
              ? 'Every open alert has somebody on it.'
              : 'No alerts match this filter.'
          "
        />
        <ul v-else class="list">
          <AlertRow
            v-for="alert in shown"
            :key="String(alert.id)"
            :alert="alert"
            :now="now"
            :acknowledging="working === String(alert.id)"
            @acknowledge="take"
          />
        </ul>
      </BasePanel>

      <p v-if="shown.length > 0" class="foot">
        Showing {{ pluralise(shown.length, 'alert') }} of {{ all.length }} raised against this site.
        Cleared alerts are kept, not deleted.
      </p>
    </QueryState>
  </section>
</template>

<style scoped>
.alerts {
  display: flex;
  flex-direction: column;
  gap: var(--gap-4);
}

.filters {
  display: flex;
  border: 1px solid var(--rule-firm);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.filters button {
  padding: var(--gap-2) var(--gap-3);
  border: 0;
  border-right: 1px solid var(--rule-hair);
  background: var(--surface-card);
  color: var(--ink-secondary);
  font: inherit;
  font-size: var(--type-sm);
  cursor: pointer;
}

.filters button:last-child {
  border-right: 0;
}

.filters button.on {
  background: var(--accent);
  color: var(--ink-inverse);
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.foot {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--type-xs);
}
</style>

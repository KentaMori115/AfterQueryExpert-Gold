<script setup lang="ts">
import { computed } from 'vue';

import { useGeneration, useSiteView } from '@/app/queries';
import type { SiteView } from '@/data/projections/site';
import { feedRatePercent } from '@/domain/feed/table';
import BasePanel from '@/ui/BasePanel.vue';
import { formatNumber, formatPercent, MISSING } from '@/ui/format';
import QueryState from '@/ui/QueryState.vue';
import StatStrip from '@/ui/StatStrip.vue';
import StatTile from '@/ui/StatTile.vue';

import FeedTable from './feed/FeedTable.vue';
import PageHeader from './PageHeader.vue';
import { isStocked } from './pens/board';

/**
 * What goes on the barge today.
 *
 * The screen is one table and four numbers, and it is deliberately not a
 * planning tool: the ration for a pen is worked out by the domain from the
 * biomass, the water and the observed appetite, and the only thing a person
 * changes here is the appetite, which lives on the pen page beside the fish it
 * describes.
 *
 * The budget comparison is here because feed is most of the cost of growing a
 * fish, and a site quietly feeding ten per cent over budget for a month is a
 * number nobody notices until the quarter closes.
 */
const siteView = useSiteView();
const generation = useGeneration();

const pens = computed(() => siteView.data.value?.pens ?? []);

const stocked = computed(() => pens.value.filter(isStocked));

const loading = computed(() =>
  stocked.value.reduce((total, view) => total + (view.feed?.recommendedKg ?? 0), 0),
);

const toTable = computed(() =>
  stocked.value.reduce((total, view) => total + (view.feed?.tableKg ?? 0), 0),
);

const biomassT = computed(
  () => stocked.value.reduce((total, view) => total + view.biomassKg, 0) / 1000,
);

const heldBack = computed(
  () => stocked.value.filter((view) => view.feed !== null && view.feed.binding !== 'table').length,
);

/**
 * Feed converted at the budget ratio, which is the honest way to state the
 * cost of a day: the fish put on this much if everything goes to plan.
 */
const budgetGrowthKg = computed(() => {
  const fcr = generation.data.value?.budgetFcr ?? null;
  return fcr === null || fcr <= 0 ? null : loading.value / fcr;
});

/** What the table would ask for at the site's own weights and water. */
const siteRate = computed(() => {
  if (stocked.value.length === 0) return null;
  const weighted = stocked.value.reduce(
    (running, view) => {
      const position = view.position!;
      const temperature = view.oxygen.latest?.temperatureC ?? null;
      if (temperature === null) return running;
      return {
        rate: running.rate + feedRatePercent(position.meanWeightG, temperature) * view.biomassKg,
        weight: running.weight + view.biomassKg,
      };
    },
    { rate: 0, weight: 0 },
  );
  return weighted.weight === 0 ? null : weighted.rate / weighted.weight;
});
</script>

<template>
  <section class="plan">
    <PageHeader
      title="Feed plan"
      note="Today's ration for each pen, worked out from the biomass, the water and what the crew
        saw the fish doing. Appetite is set on the pen page, beside the fish it describes."
    />

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
            label="Loading today"
            :value="formatNumber(loading, 0)"
            unit="kg"
            :detail="`Across ${stocked.length} pens on ${formatNumber(biomassT, 0)} t`"
          />
          <StatTile
            label="Against table"
            :value="formatPercent((loading / (toTable || 1)) * 100, 0)"
            :tone="loading < toTable * 0.9 ? 'caution' : 'good'"
            :detail="`Table asks for ${formatNumber(toTable, 0)} kg`"
          />
          <StatTile
            label="Site rate"
            :value="siteRate === null ? MISSING : formatNumber(siteRate, 2)"
            unit="%"
            detail="Of body weight, weighted by biomass"
          />
          <StatTile
            label="Growth at budget"
            :value="budgetGrowthKg === null ? MISSING : formatNumber(budgetGrowthKg, 0)"
            unit="kg"
            :detail="
              generation.data.value === undefined
                ? 'Budget ratio unknown'
                : `At the budget ratio of ${formatNumber(generation.data.value.budgetFcr, 2)}`
            "
          />
        </StatStrip>

        <BasePanel
          title="Ration by pen"
          :subtitle="
            heldBack === 0
              ? 'Every pen feeding to table'
              : `${heldBack} of ${stocked.length} pens held back`
          "
          :tone="heldBack === 0 ? 'plain' : 'caution'"
          tight
        >
          <FeedTable :pens="data.pens" />
        </BasePanel>
      </template>
    </QueryState>
  </section>
</template>

<style scoped>
.plan {
  display: flex;
  flex-direction: column;
  gap: var(--gap-4);
}
</style>

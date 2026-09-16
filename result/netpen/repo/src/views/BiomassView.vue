<script setup lang="ts">
import { computed } from 'vue';

import { useSite, useSiteView } from '@/app/queries';
import type { SiteView } from '@/data/projections/site';
import BasePanel from '@/ui/BasePanel.vue';
import BiomassChart, { type BiomassPoint } from '@/ui/charts/BiomassChart.vue';
import { formatInteger, formatNumber, formatPercent, MISSING, pluralise } from '@/ui/format';
import QueryState from '@/ui/QueryState.vue';
import StatStrip from '@/ui/StatStrip.vue';
import StatTile from '@/ui/StatTile.vue';
import { toneForUtilisation } from '@/ui/tones';

import HarvestPanel from './biomass/HarvestPanel.vue';
import PageHeader from './PageHeader.vue';

/**
 * Biomass against the licence, and what to do about it.
 *
 * The projection this page is built on assumes nothing is harvested, which
 * sounds pessimistic and is the only useful assumption: it answers "when does
 * this become a problem if we do nothing", and every harvest decision is made
 * against that date. A projection that assumed the plan would be followed
 * would only ever confirm the plan.
 */
const site = useSite();
const siteView = useSiteView();

const licenceT = computed(() => site.data.value?.maxBiomassT ?? 0);

const points = computed<BiomassPoint[]>(() => {
  const view = siteView.data.value;
  if (view === undefined) return [];
  return view.projection.map((point) => ({
    weeksAhead: point.weeksAhead,
    biomassT: point.biomassT,
  }));
});

/** Tonnes that have to come off at the week the site would first go over. */
const requiredT = computed(() => {
  const view = siteView.data.value;
  if (view === undefined || view.weeksToBreach === null) return 0;
  return view.harvestRequiredT[view.weeksToBreach] ?? 0;
});

const peak = computed(() => {
  const values = points.value.map((point) => point.biomassT);
  return values.length === 0 ? null : Math.max(...values);
});
</script>

<template>
  <section class="biomass">
    <PageHeader
      title="Biomass and harvest"
      note="Standing biomass against the licence, projected forward on the seasonal temperature
        curve with no harvest at all. The date it crosses is the date the harvest plan is built
        backwards from."
    />

    <QueryState
      :loading="siteView.isPending.value"
      :error="siteView.error.value"
      :data="siteView.data.value"
      :skeleton-lines="6"
      @retry="siteView.refetch()"
    >
      <template #default="{ data }: { data: SiteView }">
        <StatStrip min-width="170px">
          <StatTile
            label="Standing"
            :value="formatNumber(data.licence.standingT, 1)"
            unit="t"
            :detail="`${formatInteger(data.standingCount)} fish in ${data.stocked.length} pens`"
          />
          <StatTile
            label="Against licence"
            :value="formatPercent(data.licence.utilisation * 100, 0)"
            :tone="toneForUtilisation(data.licence.utilisation)"
            :detail="`${formatNumber(data.licence.limitT, 0)} t consented`"
          />
          <StatTile
            label="Headroom"
            :value="formatNumber(data.licence.headroomT, 1)"
            unit="t"
            :tone="data.licence.headroomT < 0 ? 'bad' : 'plain'"
            :detail="
              data.licence.overLimit ? 'The site is over its licence' : 'Left before the ceiling'
            "
          />
          <StatTile
            label="Licence reached"
            :value="data.weeksToBreach === null ? MISSING : String(data.weeksToBreach)"
            :unit="data.weeksToBreach === null ? undefined : 'wk'"
            :tone="data.weeksToBreach === null ? 'good' : 'caution'"
            :detail="
              data.weeksToBreach === null
                ? 'Not within the projection'
                : `In ${pluralise(data.weeksToBreach, 'week')} if nothing comes off`
            "
          />
          <StatTile
            label="Projected peak"
            :value="peak === null ? MISSING : formatNumber(peak, 0)"
            unit="t"
            detail="Highest point the projection reaches"
          />
        </StatStrip>

        <BasePanel title="Projection" subtitle="Assumes no harvest">
          <BiomassChart
            :points="points"
            :limit-t="licenceT"
            caption="Standing biomass by week against the licence"
          />
        </BasePanel>

        <HarvestPanel
          :pens="data.pens"
          :required-t="requiredT"
          :weeks-to-breach="data.weeksToBreach"
        />
      </template>
    </QueryState>
  </section>
</template>

<style scoped>
.biomass {
  display: flex;
  flex-direction: column;
  gap: var(--gap-4);
}
</style>

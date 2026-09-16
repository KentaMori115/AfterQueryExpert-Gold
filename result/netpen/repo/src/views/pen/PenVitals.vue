<script setup lang="ts">
import { computed } from 'vue';

import type { PenView } from '@/data/projections/pen';
import { DENSITY_LIMIT_KG_M3 } from '@/domain/biomass/standing';
import { formatMass, naturalUnit } from '@/domain/units/mass';
import { formatInteger, formatNumber, formatPercent, formatSigned, MISSING } from '@/ui/format';
import StatTile from '@/ui/StatTile.vue';
import { toneForDensity, toneForMortality, toneForOxygen, toneForUtilisation } from '@/ui/tones';

/**
 * The seven numbers that describe a pen.
 *
 * Growth is shown against budget rather than on its own, because the raw
 * coefficient means nothing to most of the people who read this screen and the
 * gap to budget means everything: it is the number that decides whether the
 * harvest date in the plan is still the harvest date.
 */
const props = defineProps<{
  readonly view: PenView;
}>();

const position = computed(() => props.view.position);

const meanWeight = computed(() => {
  const grams = position.value?.meanWeightG;
  return grams === undefined ? MISSING : formatMass(grams, naturalUnit(grams));
});

const densityFraction = computed(() => props.view.densityKgM3 / DENSITY_LIMIT_KG_M3);

const growthGap = computed(() => {
  const growth = props.view.growth;
  if (growth === null || growth.realisedTgc === null) return null;
  return growth.realisedTgc - growth.budgetTgc;
});

const growthTone = computed(() => {
  const gap = growthGap.value;
  if (gap === null) return 'plain' as const;
  if (gap >= 0) return 'good' as const;
  return gap > -0.3 ? ('caution' as const) : ('bad' as const);
});

const growthDetail = computed(() => {
  const growth = props.view.growth;
  if (growth === null || growth.realisedTgc === null) return 'Not enough record to fit a curve';
  return `Budget ${formatNumber(growth.budgetTgc, 2)}, ${formatSigned(growthGap.value, 2)} against it`;
});

const oxygenDetail = computed(() => {
  const low = props.view.oxygen.dayLowPercent;
  return low === null ? 'No reading in the last day' : `Low of ${formatPercent(low, 0)} in 24 h`;
});
</script>

<template>
  <div class="vitals">
    <StatTile
      label="Standing biomass"
      :value="formatNumber(view.biomassKg / 1000, 1)"
      unit="t"
      :detail="`${formatInteger(position?.count)} fish`"
    />
    <StatTile
      label="Mean weight"
      :value="meanWeight"
      :detail="
        position === null
          ? 'Nothing standing'
          : `${formatInteger(position.stockedCount)} stocked at the start`
      "
    />
    <StatTile
      label="Density"
      :value="formatNumber(view.densityKgM3, 1)"
      unit="kg/m3"
      :tone="toneForDensity(view.densityStatus)"
      :detail="`${formatPercent(densityFraction * 100, 0)} of the ${DENSITY_LIMIT_KG_M3} kg/m3 limit`"
    />
    <StatTile
      label="Degree days"
      :value="formatInteger(view.growth?.degreeDays)"
      unit="dd"
      detail="Accumulated since stocking"
    />
    <StatTile
      label="Growth"
      :value="formatNumber(view.growth?.realisedTgc, 2)"
      unit="TGC"
      :tone="growthTone"
      :detail="growthDetail"
    />
    <StatTile
      label="Mortality"
      :value="formatPercent(view.cumulativeMortalityPercent, 2)"
      :tone="toneForMortality(view.mortalityLevel)"
      :detail="`${formatPercent(view.dailyMortalityPercent, 3)} a day at the moment`"
    />
    <StatTile
      label="Oxygen"
      :value="formatPercent(view.oxygen.latest?.saturationPercent, 0)"
      :tone="toneForOxygen(view.oxygen.band)"
      :detail="oxygenDetail"
    />
    <StatTile
      label="Lice"
      :value="formatNumber(view.lice.averages?.adultFemale, 2)"
      unit="AF"
      :tone="toneForUtilisation((view.lice.averages?.adultFemale ?? 0) / 0.5)"
      :detail="
        view.lice.interval === null
          ? 'Nothing counted in this pen yet'
          : `95 % interval ${formatNumber(view.lice.interval.lower, 2)} to ${formatNumber(view.lice.interval.upper, 2)}`
      "
    />
  </div>
</template>

<style scoped>
.vitals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: var(--gap-3);
}
</style>

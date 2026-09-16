<script setup lang="ts">
import { computed } from 'vue';

import type { PenView } from '@/data/projections/pen';
import { DENSITY_LIMIT_KG_M3 } from '@/domain/biomass/standing';
import { PEN_STATUS_LABELS } from '@/domain/site/types';
import { formatMass, naturalUnit } from '@/domain/units/mass';
import AppIcon from '@/ui/AppIcon.vue';
import BaseBadge from '@/ui/BaseBadge.vue';
import { formatInteger, formatNumber, formatPercent, MISSING } from '@/ui/format';
import { toneForDensity, toneForLice, toneForMortality, toneForOxygen } from '@/ui/tones';

/**
 * One pen, as it appears on the board.
 *
 * The card is read from six feet away on a barge screen, so it is built around
 * one question: does this pen need somebody today. The badge strip answers it
 * and everything below is the supporting detail. Only the worst badge is
 * solid, because a row where every badge shouts is a row nobody reads.
 */
const props = defineProps<{
  readonly view: PenView;
}>();

const stocked = computed(() => props.view.position !== null && props.view.position.count > 0);

const liceTone = computed(() => toneForLice(props.view.lice.status));
const oxygenTone = computed(() => toneForOxygen(props.view.oxygen.band));
const densityTone = computed(() => toneForDensity(props.view.densityStatus));
const mortalityTone = computed(() => toneForMortality(props.view.mortalityLevel));

/**
 * The one badge allowed to be solid. Ties break toward lice, which is the one
 * with a statutory clock attached to it.
 */
const loudest = computed<'lice' | 'oxygen' | 'density' | 'mortality' | null>(() => {
  const ranked = [
    ['lice', liceTone.value],
    ['oxygen', oxygenTone.value],
    ['density', densityTone.value],
    ['mortality', mortalityTone.value],
  ] as const;
  const bad = ranked.find(([, tone]) => tone === 'bad');
  if (bad) return bad[0];
  const caution = ranked.find(([, tone]) => tone === 'caution');
  return caution ? caution[0] : null;
});

const liceLabel = computed(() => {
  const value = props.view.lice.averages?.adultFemale;
  return value === undefined ? 'Not counted' : `${formatNumber(value, 2)} AF`;
});

const meanWeight = computed(() => {
  const grams = props.view.position?.meanWeightG;
  return grams === undefined ? MISSING : formatMass(grams, naturalUnit(grams));
});

const biomass = computed(() => formatNumber(props.view.biomassKg / 1000, 1));

const densityFraction = computed(() => props.view.densityKgM3 / DENSITY_LIMIT_KG_M3);

const withdrawalNote = computed(() => {
  const withdrawal = props.view.withdrawal;
  if (withdrawal === null || withdrawal.cleared) return null;
  return `${formatNumber(withdrawal.remaining, 0)} degree days to withdrawal`;
});
</script>

<template>
  <RouterLink class="card" :class="{ idle: !stocked }" :to="`/pens/${view.pen.id}`">
    <header>
      <h3>
        <AppIcon name="pen" />
        Pen {{ view.pen.number }}
      </h3>
      <span v-if="!stocked" class="status">{{ PEN_STATUS_LABELS[view.pen.status] }}</span>
      <span v-else class="status">{{ formatInteger(view.position?.count) }} fish</span>
    </header>

    <div v-if="stocked" class="badges">
      <BaseBadge :tone="liceTone" :solid="loudest === 'lice'" dot title="Adult female lice">
        {{ liceLabel }}
      </BaseBadge>
      <BaseBadge :tone="oxygenTone" :solid="loudest === 'oxygen'" title="Latest oxygen saturation">
        {{ formatPercent(view.oxygen.latest?.saturationPercent, 0) }} O2
      </BaseBadge>
      <BaseBadge :tone="densityTone" :solid="loudest === 'density'" title="Standing density">
        {{ formatNumber(view.densityKgM3, 1) }} kg/m3
      </BaseBadge>
      <BaseBadge
        v-if="view.mortalityLevel !== 'normal' && view.mortalityLevel !== 'unknown'"
        :tone="mortalityTone"
        :solid="loudest === 'mortality'"
        title="Daily mortality"
      >
        {{ formatPercent(view.dailyMortalityPercent, 3) }}/d
      </BaseBadge>
    </div>

    <dl v-if="stocked" class="figures">
      <div>
        <dt>Biomass</dt>
        <dd>{{ biomass }} <span class="unit">t</span></dd>
      </div>
      <div>
        <dt>Mean weight</dt>
        <dd>{{ meanWeight }}</dd>
      </div>
      <div>
        <dt>At sea</dt>
        <dd>{{ view.weeksAtSea ?? MISSING }} <span class="unit">wk</span></dd>
      </div>
    </dl>

    <p v-else class="empty">Nothing standing in this pen.</p>

    <div v-if="stocked" class="fill" :title="`${formatPercent(densityFraction * 100, 0)} of limit`">
      <span class="track">
        <span
          class="level"
          :class="densityTone"
          :style="{ width: `${Math.min(100, densityFraction * 100).toFixed(1)}%` }"
        />
      </span>
    </div>

    <p v-if="withdrawalNote" class="withdrawal">
      <AppIcon name="clock" />
      {{ withdrawalNote }}
    </p>
    <p v-else-if="view.lice.obligation.required" class="obligation">
      <AppIcon name="louse" />
      {{ view.lice.obligation.reason }}
    </p>
  </RouterLink>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: var(--gap-3);
  padding: var(--gap-4);
  border: 1px solid var(--rule-hair);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  color: inherit;
  text-decoration: none;
}

.card:hover {
  border-color: var(--rule-firm);
}

.card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.idle {
  background: var(--surface-sunken);
}

header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--gap-2);
}

h3 {
  display: flex;
  align-items: center;
  gap: var(--gap-2);
  margin: 0;
  font-size: var(--type-md);
}

.status {
  color: var(--ink-muted);
  font-size: var(--type-xs);
  font-variant-numeric: tabular-nums;
}

.badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-2);
}

.figures {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--gap-2);
  margin: 0;
}

dt {
  color: var(--ink-muted);
  font-size: var(--type-xs);
}

dd {
  margin: 0;
  font-size: var(--type-md);
  font-variant-numeric: tabular-nums;
}

.unit {
  color: var(--ink-muted);
  font-size: var(--type-xs);
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
  background: var(--pass);
}

.level.caution {
  background: var(--caution);
}

.level.bad {
  background: var(--fault);
}

.empty,
.withdrawal,
.obligation {
  display: flex;
  align-items: center;
  gap: var(--gap-2);
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--type-xs);
}

.obligation {
  color: var(--fault);
}
</style>

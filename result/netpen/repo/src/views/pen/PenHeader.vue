<script setup lang="ts">
import { computed } from 'vue';

import type { PenView } from '@/data/projections/pen';
import { PEN_STATUS_LABELS } from '@/domain/site/types';
import { formatCycleAge } from '@/domain/time/duration';
import AppIcon from '@/ui/AppIcon.vue';
import BaseBadge from '@/ui/BaseBadge.vue';
import { formatDate, formatInteger, MISSING } from '@/ui/format';
import { toneForDensity, toneForLice, toneForMortality, toneForOxygen } from '@/ui/tones';

/**
 * The identity line on the pen page.
 *
 * It answers the questions somebody asks in the first two seconds: which pen,
 * what is in it, how long it has been there, and is anything wrong. The states
 * repeat what the board card said on purpose. Somebody who clicked through
 * from a red card should see the same red here, or they will assume the click
 * took them somewhere else.
 */
const props = defineProps<{
  readonly view: PenView;
  /** The instant the view was projected against, so both agree. */
  readonly now: number;
  readonly openAlerts?: number;
}>();

const stocked = computed(() => props.view.position !== null && props.view.position.count > 0);

const states = computed(() => {
  if (!stocked.value) return [];
  const view = props.view;
  return [
    { key: 'lice', label: 'Lice', value: view.lice.status, tone: toneForLice(view.lice.status) },
    {
      key: 'oxygen',
      label: 'Oxygen',
      value: view.oxygen.band,
      tone: toneForOxygen(view.oxygen.band),
    },
    {
      key: 'density',
      label: 'Density',
      value: view.densityStatus,
      tone: toneForDensity(view.densityStatus),
    },
    {
      key: 'mortality',
      label: 'Mortality',
      value: view.mortalityLevel,
      tone: toneForMortality(view.mortalityLevel),
    },
  ].filter((state) => state.value !== 'unknown');
});

const cycleAge = computed(() =>
  props.view.group === null ? MISSING : formatCycleAge(props.view.group.stockedAt, props.now),
);

const stockedOn = computed(() =>
  props.view.group === null ? MISSING : formatDate(props.view.group.stockedAt),
);
</script>

<template>
  <header class="head">
    <div class="who">
      <h2>
        <AppIcon name="pen" />
        Pen {{ view.pen.number }}
      </h2>
      <p class="line">
        <span>{{ view.generation.code }} {{ view.generation.strain }}</span>
        <span aria-hidden="true">/</span>
        <span>{{ view.pen.geometry.circumferenceM }} m circumference</span>
        <span aria-hidden="true">/</span>
        <span>{{ view.pen.geometry.depthM }} m net</span>
      </p>
    </div>

    <dl class="facts">
      <div>
        <dt>Standing</dt>
        <dd>
          {{
            stocked
              ? `${formatInteger(view.position?.count)} fish`
              : PEN_STATUS_LABELS[view.pen.status]
          }}
        </dd>
      </div>
      <div>
        <dt>Stocked</dt>
        <dd>{{ stockedOn }}</dd>
      </div>
      <div>
        <dt>Cycle age</dt>
        <dd>{{ cycleAge }}</dd>
      </div>
      <div v-if="openAlerts">
        <dt>Open alerts</dt>
        <dd class="alerts">
          <AppIcon name="alert" />
          {{ openAlerts }}
        </dd>
      </div>
    </dl>

    <ul v-if="states.length > 0" class="states">
      <li v-for="state in states" :key="state.key">
        <BaseBadge :tone="state.tone" dot :title="`${state.label}: ${state.value}`">
          {{ state.label }}
        </BaseBadge>
      </li>
    </ul>
  </header>
</template>

<style scoped>
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gap-4);
  padding-bottom: var(--gap-4);
  border-bottom: 1px solid var(--rule-hair);
}

h2 {
  display: flex;
  align-items: center;
  gap: var(--gap-2);
  margin: 0;
  font-size: var(--type-xl);
}

.line {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-2);
  margin: var(--gap-1) 0 0;
  color: var(--ink-muted);
  font-size: var(--type-sm);
}

.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-5);
  margin: 0;
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

.alerts {
  display: flex;
  align-items: center;
  gap: var(--gap-1);
  color: var(--fault);
}

.states {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>

<script setup lang="ts">
import { computed } from 'vue';

import type { PenView } from '@/data/projections/pen';
import { CONSTRAINT_LABELS, type Appetite } from '@/domain/feed/plan';
import { pelletSizeFor } from '@/domain/feed/table';
import BaseBadge from '@/ui/BaseBadge.vue';
import BasePanel from '@/ui/BasePanel.vue';
import { formatNumber, formatPercent, MISSING } from '@/ui/format';
import HeadlineFigure from '@/ui/HeadlineFigure.vue';

/**
 * Today's ration.
 *
 * The number the crew act on is one figure, and every screen that shows it has
 * to show why it is that figure. A barge that is told to feed 1.4 t when the
 * table says 2.1 t and is given no reason will feed 2.1 t, and the pen will go
 * hypoxic in the afternoon.
 *
 * So the panel is built around the binding constraint. Everything else is
 * listed underneath with what it would have allowed, which also makes it
 * obvious when two constraints are close and the ration is about to move.
 */
const props = defineProps<{
  readonly view: PenView;
  readonly appetite: Appetite;
}>();

const emit = defineEmits<{ 'update:appetite': [Appetite] }>();

const APPETITES: readonly { value: Appetite; label: string }[] = [
  { value: 'keen', label: 'Keen' },
  { value: 'normal', label: 'Normal' },
  { value: 'slow', label: 'Slow' },
  { value: 'off', label: 'Off feed' },
];

const plan = computed(() => props.view.feed);

const held = computed(() => plan.value !== null && plan.value.binding !== 'table');

const pellet = computed(() => {
  const grams = props.view.position?.meanWeightG;
  return grams === undefined ? null : pelletSizeFor(grams);
});

const others = computed(() => {
  const current = plan.value;
  if (current === null) return [];
  return current.constraints
    .filter((entry) => entry.constraint !== current.binding)
    .sort((a, b) => a.allowsKg - b.allowsKg);
});
</script>

<template>
  <BasePanel title="Feed" subtitle="Ration for today" :tone="held ? 'caution' : 'plain'">
    <div v-if="plan === null" class="none">
      Nothing to feed. The pen is empty, or there is no water reading to plan against.
    </div>

    <template v-else>
      <div class="headline">
        <HeadlineFigure :value="formatNumber(plan.recommendedKg, 0)" unit="kg" />
        <div class="why">
          <BaseBadge :tone="held ? 'caution' : 'good'" solid>
            {{ CONSTRAINT_LABELS[plan.binding] }}
          </BaseBadge>
          <span v-if="held" class="against">
            Table says {{ formatNumber(plan.tableKg, 0) }} kg, so
            {{ formatPercent(plan.fraction * 100, 0) }} of it
          </span>
          <span v-else class="against">
            {{ formatNumber(plan.ratePercent, 2) }} % of body weight
          </span>
        </div>
      </div>

      <ul class="constraints">
        <li v-for="entry in others" :key="entry.constraint">
          <span class="name">{{ CONSTRAINT_LABELS[entry.constraint] }}</span>
          <span class="allows">{{ formatNumber(entry.allowsKg, 0) }} kg</span>
        </li>
      </ul>

      <dl class="detail">
        <div>
          <dt>Pellet</dt>
          <dd>{{ pellet === null ? MISSING : `${formatNumber(pellet, 1)} mm` }}</dd>
        </div>
        <div>
          <dt>Sea temperature</dt>
          <dd>{{ formatNumber(view.oxygen.latest?.temperatureC, 1) }} C</dd>
        </div>
        <div>
          <dt>Oxygen</dt>
          <dd>{{ formatPercent(view.oxygen.latest?.saturationPercent, 0) }}</dd>
        </div>
      </dl>

      <fieldset class="appetite">
        <legend>Observed appetite</legend>
        <label v-for="option in APPETITES" :key="option.value">
          <input
            type="radio"
            name="appetite"
            :value="option.value"
            :checked="appetite === option.value"
            @change="emit('update:appetite', option.value)"
          />
          {{ option.label }}
        </label>
      </fieldset>
    </template>
  </BasePanel>
</template>

<style scoped>
.headline {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--gap-3);
}

.against {
  color: var(--ink-muted);
  font-size: var(--type-sm);
}

.why {
  display: flex;
  align-items: center;
  gap: var(--gap-3);
}

.constraints {
  margin: var(--gap-4) 0 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--rule-hair);
}

.constraints li {
  display: flex;
  justify-content: space-between;
  gap: var(--gap-3);
  padding: var(--gap-2) 0;
  border-bottom: 1px solid var(--rule-hair);
  font-size: var(--type-sm);
}

.name {
  color: var(--ink-secondary);
}

.allows {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
}

.detail {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-5);
  margin: var(--gap-4) 0 0;
}

dt {
  color: var(--ink-muted);
  font-size: var(--type-xs);
}

dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.appetite {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-3);
  margin: var(--gap-4) 0 0;
  padding: var(--gap-3);
  border: 1px solid var(--rule-hair);
  border-radius: var(--radius-sm);
}

legend {
  padding: 0 var(--gap-2);
  color: var(--ink-muted);
  font-size: var(--type-xs);
}

.appetite label {
  display: flex;
  align-items: center;
  gap: var(--gap-1);
  font-size: var(--type-sm);
}

.none {
  color: var(--ink-muted);
  font-size: var(--type-sm);
}
</style>

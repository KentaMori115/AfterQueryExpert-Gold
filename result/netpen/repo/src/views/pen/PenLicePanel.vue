<script setup lang="ts">
import { computed } from 'vue';

import type { PenView } from '@/data/projections/pen';
import { dispersionIndex } from '@/domain/lice/counts';
import type { Regime } from '@/domain/lice/thresholds';
import { limitFor } from '@/domain/lice/thresholds';
import { isoWeekOf, weeksAtSea } from '@/domain/time/duration';
import BaseBadge from '@/ui/BaseBadge.vue';
import BasePanel from '@/ui/BasePanel.vue';
import LiceChart, { type WeeklyPoint } from '@/ui/charts/LiceChart.vue';
import { formatDate, formatNumber, MISSING, pluralise } from '@/ui/format';
import HeadlineFigure from '@/ui/HeadlineFigure.vue';
import { toneForLice } from '@/ui/tones';

/**
 * Lice, as the register sees them.
 *
 * The stage breakdown is here rather than only the headline figure because the
 * headline is a lagging indicator: a pen with chalimus climbing and adult
 * females still clear is a pen that will breach in a fortnight, and treating
 * it now is a different decision from treating it then.
 *
 * The dispersion figure looks academic and is not. Lice cluster, so a mean of
 * 0.3 over twenty fish where three fish carried all of them is a mean that
 * will move a long way on the next count.
 */
const props = defineProps<{
  readonly view: PenView;
  readonly regime: Regime;
}>();

const latest = computed(() => props.view.lice.latest);
const averages = computed(() => props.view.lice.averages);

const stages = computed(() => {
  const average = averages.value;
  if (average === null) return [];
  return [
    { key: 'chalimus', label: 'Chalimus', value: average.chalimus },
    { key: 'preAdult', label: 'Pre adult', value: average.preAdult },
    { key: 'adultMale', label: 'Adult male', value: average.adultMale },
    { key: 'adultFemale', label: 'Adult female', value: average.adultFemale },
    { key: 'caligus', label: 'Caligus', value: average.caligus },
  ];
});

const dispersion = computed(() => {
  const count = latest.value;
  return count === null ? null : dispersionIndex(count.sample, 'adultFemale');
});

const clustered = computed(() => dispersion.value !== null && dispersion.value > 2);

const points = computed<WeeklyPoint[]>(() => {
  const stockedAt = props.view.group?.stockedAt ?? null;
  return props.view.lice.weekly.map((entry, index) => ({
    week: entry.week,
    value: entry.adultFemale,
    cycleWeek:
      stockedAt === null
        ? index + 1
        : weeksAtSea(
            stockedAt,
            Date.UTC(entry.week.year, 0, 4) + (entry.week.week - 1) * 604_800_000,
          ),
  }));
});

/**
 * The limit that applied to the week the count was taken, read off the count
 * itself rather than off the weekly series. The series can be empty while a
 * count exists, and in the spring window the wrong week is the wrong limit.
 */
const limit = computed(() =>
  latest.value === null ? null : limitFor(props.regime, isoWeekOf(latest.value.countedAt)),
);
</script>

<template>
  <BasePanel
    title="Sea lice"
    :subtitle="
      latest === null
        ? 'Never counted'
        : `Counted ${formatDate(latest.countedAt)} by ${latest.countedBy}`
    "
    :tone="view.lice.status === 'clear' ? 'plain' : 'caution'"
  >
    <div v-if="latest === null" class="none">
      <p>No count has been filed against this pen.</p>
      <p class="why">
        The regime asks for a count every week the pen is in the water. An uncounted pen is treated
        as a breach by the auditor, not as a gap.
      </p>
    </div>

    <template v-else>
      <div class="headline">
        <HeadlineFigure
          :value="formatNumber(averages?.adultFemale, 2)"
          label="adult female per fish"
        />
        <div class="context">
          <BaseBadge :tone="toneForLice(view.lice.status)" solid dot>
            {{ view.lice.status.replace('-', ' ') }}
          </BaseBadge>
          <span class="limit">Limit {{ formatNumber(limit, 2) }}</span>
          <span v-if="view.lice.weeksOver > 0" class="over">
            {{ pluralise(view.lice.weeksOver, 'week') }} over
          </span>
        </div>
      </div>

      <p v-if="view.lice.obligation.required" class="obligation">
        {{ view.lice.obligation.reason }}
        <template v-if="view.lice.obligation.daysRemaining !== null">
          Treatment due within {{ pluralise(view.lice.obligation.daysRemaining, 'day') }}.
        </template>
      </p>

      <dl class="stages">
        <div v-for="stage in stages" :key="stage.key">
          <dt>{{ stage.label }}</dt>
          <dd>{{ formatNumber(stage.value, 2) }}</dd>
        </div>
      </dl>

      <p class="sample">
        {{ latest.sample.length }} fish examined.
        <template v-if="dispersion !== null">
          Dispersion {{ formatNumber(dispersion, 1) }},
          <span :class="{ clustered }">{{
            clustered ? 'heavily clustered, so the mean will move' : 'evenly spread'
          }}</span
          >.
        </template>
        <template v-if="latest.seaTemperatureC !== null">
          Sea {{ formatNumber(latest.seaTemperatureC, 1) }} C.
        </template>
      </p>

      <LiceChart
        v-if="points.length > 1"
        :points="points"
        :regime="regime"
        caption="Adult female by week, against the limit"
      />
      <p v-else class="thin">One count is not a record. The chart starts at two.</p>

      <p v-if="latest.note" class="note">{{ latest.note }}</p>
      <p v-else class="note muted">{{ MISSING }}</p>
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

.context {
  display: flex;
  align-items: center;
  gap: var(--gap-3);
}

.limit {
  color: var(--ink-muted);
  font-size: var(--type-sm);
}

.over {
  color: var(--fault);
  font-size: var(--type-sm);
}

.obligation {
  margin: var(--gap-3) 0 0;
  padding: var(--gap-2) var(--gap-3);
  border-left: 3px solid var(--fault);
  background: var(--fault-wash);
  font-size: var(--type-sm);
}

.stages {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: var(--gap-2);
  margin: var(--gap-4) 0 0;
}

dt {
  color: var(--ink-muted);
  font-size: var(--type-xs);
}

dd {
  margin: 0;
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
}

.sample,
.thin,
.note,
.why {
  margin: var(--gap-3) 0 0;
  color: var(--ink-muted);
  font-size: var(--type-sm);
}

.clustered {
  color: var(--caution);
}

.none p {
  margin: 0;
}
</style>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { useClock } from '@/app/clock';
import { useAlerts, usePen, useSite } from '@/app/queries';
import type { PenView } from '@/data/projections/pen';
import type { Appetite } from '@/domain/feed/plan';
import AppIcon from '@/ui/AppIcon.vue';
import QueryState from '@/ui/QueryState.vue';

import PenFeedPanel from './pen/PenFeedPanel.vue';
import PenHeader from './pen/PenHeader.vue';
import PenHealthPanel from './pen/PenHealthPanel.vue';
import PenLicePanel from './pen/PenLicePanel.vue';
import PenVitals from './pen/PenVitals.vue';
import RecordMortalityDialog from './pen/RecordMortalityDialog.vue';
import RecordTreatmentDialog from './pen/RecordTreatmentDialog.vue';

/**
 * One pen, in full.
 *
 * The order down the page is the order somebody works through a pen: what is
 * in it, how it is doing, what the lice are doing, what to feed it today, and
 * what has been done to it. Panels do not collapse. A collapsed panel on a
 * monitoring screen is a panel nobody opens, and the thing hiding in it is
 * usually the thing that mattered.
 *
 * Appetite lives here rather than in the store. It is an observation about one
 * pen on one morning, not a preference, and carrying it between pens would put
 * yesterday's judgement on today's ration.
 */
const route = useRoute();
const { now } = useClock();

const penId = computed(() => String(route.params.penId ?? ''));
const pen = usePen(penId);
const site = useSite();
const alerts = useAlerts();

const appetite = ref<Appetite>('normal');
const recording = ref<'treatment' | 'mortality' | null>(null);

// A different pen is a different observation, so the judgement resets with it,
// and a form left open on the old pen would otherwise file against the new one.
watch(penId, () => {
  appetite.value = 'normal';
  recording.value = null;
});

function refresh(): void {
  void pen.refetch();
  void alerts.refetch();
}

const openAlerts = computed(
  () =>
    (alerts.data.value ?? []).filter(
      (alert) => alert.subject.type !== 'site' && String(alert.subject.penId) === penId.value,
    ).length,
);

const regime = computed(() => site.data.value?.regime ?? 'norway');
</script>

<template>
  <QueryState
    :loading="pen.isPending.value"
    :error="pen.error.value"
    :data="pen.data.value"
    :skeleton-lines="8"
    @retry="pen.refetch()"
  >
    <template #default="{ data }: { data: PenView }">
      <article class="pen">
        <RouterLink class="back" to="/pens">
          <AppIcon name="chevron" class="flip" />
          All pens
        </RouterLink>

        <PenHeader :view="data" :now="now" :open-alerts="openAlerts" />

        <PenVitals :view="data" />

        <div class="columns">
          <PenLicePanel :view="data" :regime="regime" />
          <PenFeedPanel :view="data" :appetite="appetite" @update:appetite="appetite = $event" />
        </div>

        <PenHealthPanel
          :view="data"
          @treat="recording = 'treatment'"
          @mort="recording = 'mortality'"
        />

        <RecordTreatmentDialog
          v-if="recording === 'treatment'"
          open
          :view="data"
          @close="recording = null"
          @recorded="refresh"
        />
        <RecordMortalityDialog
          v-if="recording === 'mortality'"
          open
          :view="data"
          @close="recording = null"
          @recorded="refresh"
        />
      </article>
    </template>
  </QueryState>
</template>

<style scoped>
.pen {
  display: flex;
  flex-direction: column;
  gap: var(--gap-4);
}

.back {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-1);
  align-self: flex-start;
  color: var(--ink-muted);
  font-size: var(--type-sm);
  text-decoration: none;
}

.back:hover {
  color: var(--accent);
}

.flip {
  transform: rotate(180deg);
}

.columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--gap-4);
  align-items: start;
}
</style>

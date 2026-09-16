<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { useClock } from '@/app/clock';
import { useRecordMortality } from '@/app/queries';
import type { PenView } from '@/data/projections/pen';
import {
  CAUSE_LABELS,
  isOperational,
  MORTALITY_CAUSES,
  type MortalityCause,
} from '@/domain/health/mortality';
import BaseDialog from '@/ui/BaseDialog.vue';
import { formatInteger, formatNumber, formatPercent } from '@/ui/format';

import { discardGuard, fileQuietly } from '../recording';

/**
 * The mort lift.
 *
 * Entered as a count of fish and a mean weight, which is what comes off the
 * boat, and shown back as a percentage of the pen and as biomass, which is
 * what the figures are judged against. Doing that conversion on the screen
 * rather than in somebody's head is the point of the form: four hundred fish
 * sounds like a lot and is a fifth of a per cent.
 */
const props = defineProps<{
  readonly open: boolean;
  readonly view: PenView;
}>();

const emit = defineEmits<{ close: []; recorded: [] }>();

const { now } = useClock();
const record = useRecordMortality();

const count = ref('');
const meanWeight = ref('');
const cause = ref<MortalityCause>('natural');
const note = ref('');

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    count.value = '';
    cause.value = 'natural';
    note.value = '';
    // The standing mean is the right default: morts are usually close to the
    // pen average, and a crew that has not weighed them would otherwise be
    // guessing at a figure the biomass depends on.
    const standing = props.view.position?.meanWeightG;
    meanWeight.value = standing === undefined ? '' : String(Math.round(standing));
    record.reset();
  },
  { immediate: true },
);

const parsedCount = computed(() => {
  const parsed = Number.parseInt(count.value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
});

const parsedWeight = computed(() => {
  const parsed = Number.parseFloat(meanWeight.value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
});

const standingCount = computed(() => props.view.position?.count ?? 0);

const share = computed(() =>
  parsedCount.value === null || standingCount.value === 0
    ? null
    : (parsedCount.value / standingCount.value) * 100,
);

const biomassKg = computed(() =>
  parsedCount.value === null || parsedWeight.value === null
    ? null
    : (parsedCount.value * parsedWeight.value) / 1000,
);

const tooMany = computed(
  () => parsedCount.value !== null && parsedCount.value > standingCount.value,
);

const canRecord = computed(
  () =>
    parsedCount.value !== null &&
    parsedWeight.value !== null &&
    !tooMany.value &&
    !record.isPending.value,
);

const guard = discardGuard(
  () => count.value !== '' || note.value !== '',
  'Close without recording this mortality?',
);

async function save(): Promise<void> {
  if (!canRecord.value || props.view.group === null) return;

  const result = await fileQuietly(() =>
    record.mutateAsync({
      groupId: String(props.view.group!.id),
      count: parsedCount.value!,
      meanWeightG: parsedWeight.value!,
      cause: cause.value,
      note: note.value,
      at: now.value,
    }),
  );
  if (!result.filed) return;

  emit('recorded');
  emit('close');
}
</script>

<template>
  <BaseDialog
    :open="open"
    title="Record mortality"
    :subtitle="`Pen ${view.pen.number}`"
    width="34rem"
    :before-close="guard"
    @close="emit('close')"
  >
    <form class="form" @submit.prevent="save">
      <div class="fields">
        <label class="field">
          Fish
          <input
            v-model="count"
            class="control"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
          />
        </label>
        <label class="field">
          Mean weight
          <input
            v-model="meanWeight"
            class="control"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
          />
        </label>
        <label class="field">
          Cause
          <select v-model="cause" class="control">
            <option v-for="option in MORTALITY_CAUSES" :key="option" :value="option">
              {{ CAUSE_LABELS[option] }}
            </option>
          </select>
        </label>
        <label class="field wide">
          Note
          <input v-model="note" class="control" type="text" maxlength="200" />
        </label>
      </div>

      <p v-if="isOperational(cause)" class="operational">
        This one counts as operational mortality, which is reported separately from natural loss.
      </p>

      <dl v-if="parsedCount !== null" class="effect">
        <div>
          <dt>Share of the pen</dt>
          <dd>{{ formatPercent(share, 3) }}</dd>
        </div>
        <div>
          <dt>Biomass off</dt>
          <dd>{{ formatNumber(biomassKg, 0) }} kg</dd>
        </div>
        <div>
          <dt>Standing after</dt>
          <dd>{{ formatInteger(standingCount - (parsedCount ?? 0)) }}</dd>
        </div>
      </dl>

      <p v-if="tooMany" class="failed" role="alert">
        That is more fish than the pen is carrying. Check the count before filing it.
      </p>

      <p v-else-if="record.isError.value" class="failed" role="alert">
        That was not accepted. Nothing has been recorded.
      </p>
    </form>

    <template #actions="{ close }">
      <button type="button" class="control-button ghost" @click="close">Cancel</button>
      <button
        type="button"
        class="control-button control-primary"
        :disabled="!canRecord"
        @click="save"
      >
        {{ record.isPending.value ? 'Recording' : 'Record mortality' }}
      </button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--gap-4);
}

.fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--gap-3);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--gap-1);
  color: var(--ink-muted);
  font-size: var(--type-xs);
}

.wide {
  grid-column: 1 / -1;
}

.effect {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-5);
  margin: 0;
  padding: var(--gap-3);
  border: 1px solid var(--rule-hair);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
}

dt {
  color: var(--ink-muted);
  font-size: var(--type-xs);
}

dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.operational {
  margin: 0;
  color: var(--caution);
  font-size: var(--type-sm);
}

.failed {
  margin: 0;
  color: var(--fault);
  font-size: var(--type-sm);
}
</style>

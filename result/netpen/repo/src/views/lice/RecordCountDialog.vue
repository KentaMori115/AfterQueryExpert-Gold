<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { useClock } from '@/app/clock';
import { usePeople, useRecordCount } from '@/app/queries';
import { averages, EMPTY_FISH, MINIMUM_SAMPLE, type FishCount } from '@/domain/lice/counts';
import BaseDialog from '@/ui/BaseDialog.vue';
import { formatNumber } from '@/ui/format';

import { discardGuard, fileQuietly } from '../recording';
import CountEntryGrid from './CountEntryGrid.vue';

/**
 * Filing a lice count.
 *
 * The count goes into a statutory register, so the form is deliberately
 * unhelpful in one respect: it will not pre-fill the sample from last week or
 * from anywhere else. Every figure in it has to have been read off a fish this
 * morning, and a form that starts with last week's numbers in it is a form
 * that will eventually file last week's numbers.
 *
 * It will, however, refuse to lose work. Closing with something entered asks
 * first, which is what the guard on the dialog is for.
 */
const props = defineProps<{
  readonly open: boolean;
  readonly penId: string;
  readonly penNumber: number;
}>();

const emit = defineEmits<{ close: []; filed: [] }>();

function freshSample(): FishCount[] {
  return Array.from({ length: MINIMUM_SAMPLE }, () => ({ ...EMPTY_FISH }));
}

const { now } = useClock();
const people = usePeople();
const record = useRecordCount();

const sample = ref<FishCount[]>(freshSample());
const countedBy = ref('');
const seaTemperature = ref('');
const note = ref('');

// A fresh form every time it opens. See the note above about pre-filling.
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    sample.value = freshSample();
    countedBy.value = '';
    seaTemperature.value = '';
    note.value = '';
    record.reset();
  },
  // Immediate, because the parent mounts this with open already true: without
  // it the form is only ever reset on the second opening.
  { immediate: true },
);

const counters = computed(() => people.data.value ?? []);

const touched = computed(() =>
  sample.value.some(
    (fish) =>
      fish.adultFemale > 0 ||
      fish.preAdult > 0 ||
      fish.adultMale > 0 ||
      fish.chalimus > 0 ||
      fish.caligus > 0,
  ),
);

const means = computed(() => averages(sample.value));

const problems = computed(() => {
  const found: string[] = [];
  if (countedBy.value === '') found.push('Say who counted.');
  if (sample.value.length === 0) found.push('A count needs at least one fish.');

  const temperature = Number.parseFloat(seaTemperature.value);
  if (
    seaTemperature.value !== '' &&
    (!Number.isFinite(temperature) || temperature < -2 || temperature > 30)
  ) {
    found.push('That sea temperature is not a temperature this water reaches.');
  }

  return found;
});

const canFile = computed(() => problems.value.length === 0 && !record.isPending.value);

const guard = discardGuard(
  () => touched.value || countedBy.value !== '',
  'Close without filing this count? What has been entered is lost.',
);

async function file(): Promise<void> {
  if (!canFile.value) return;

  const temperature = Number.parseFloat(seaTemperature.value);
  const result = await fileQuietly(() =>
    record.mutateAsync({
      penId: props.penId,
      sample: sample.value,
      countedBy: countedBy.value,
      seaTemperatureC: Number.isFinite(temperature) ? temperature : null,
      note: note.value,
      at: now.value,
    }),
  );
  if (!result.filed) return;

  emit('filed');
  emit('close');
}
</script>

<template>
  <BaseDialog
    :open="open"
    title="Record a lice count"
    :subtitle="`Pen ${penNumber}`"
    width="52rem"
    :before-close="guard"
    @close="emit('close')"
  >
    <form class="form" @submit.prevent="file">
      <CountEntryGrid :sample="sample" @update:sample="sample = [...$event]" />

      <div class="fields">
        <label>
          Counted by
          <select v-model="countedBy" class="control" required>
            <option value="" disabled>Choose</option>
            <option v-for="person in counters" :key="String(person.id)" :value="String(person.id)">
              {{ person.name }}
            </option>
          </select>
        </label>

        <label>
          Sea temperature
          <span class="withUnit">
            <input
              v-model="seaTemperature"
              class="control"
              type="number"
              step="0.1"
              inputmode="decimal"
            />
            <span class="unit">C</span>
          </span>
        </label>

        <label class="wide">
          Note
          <input
            v-model="note"
            class="control"
            type="text"
            maxlength="200"
            placeholder="Anything worth saying"
          />
        </label>
      </div>

      <p class="summary">
        Filing {{ formatNumber(means?.adultFemale, 2) }} adult female per fish over
        {{ sample.length }} fish.
      </p>

      <ul v-if="problems.length > 0 && touched" class="problems">
        <li v-for="problem in problems" :key="problem">{{ problem }}</li>
      </ul>

      <p v-if="record.isError.value" class="failed" role="alert">
        That count was not accepted. Nothing has been filed, so it can be sent again.
      </p>
    </form>

    <template #actions="{ close }">
      <button type="button" class="control-button ghost" @click="close">Cancel</button>
      <button
        type="button"
        class="control-button control-primary"
        :disabled="!canFile"
        @click="file"
      >
        {{ record.isPending.value ? 'Filing' : 'File count' }}
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
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--gap-3);
}

label {
  display: flex;
  flex-direction: column;
  gap: var(--gap-1);
  color: var(--ink-muted);
  font-size: var(--type-xs);
}

.wide {
  grid-column: 1 / -1;
}

.withUnit {
  display: flex;
  align-items: center;
  gap: var(--gap-2);
}

.withUnit input {
  flex: 1;
  min-width: 0;
}

.unit {
  color: var(--ink-muted);
}

.summary {
  margin: 0;
  color: var(--ink-secondary);
  font-size: var(--type-sm);
}

.problems {
  margin: 0;
  padding-left: var(--gap-5);
  color: var(--caution);
  font-size: var(--type-sm);
}

.failed {
  margin: 0;
  color: var(--fault);
  font-size: var(--type-sm);
}
</style>

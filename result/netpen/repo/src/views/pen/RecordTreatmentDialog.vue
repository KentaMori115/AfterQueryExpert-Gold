<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { useClock } from '@/app/clock';
import { useRecordTreatment } from '@/app/queries';
import type { PenView } from '@/data/projections/pen';
import {
  projectedAfter,
  profileFor,
  TREATMENTS,
  type TreatmentMethod,
} from '@/domain/health/treatment';
import BaseDialog from '@/ui/BaseDialog.vue';
import { formatNumber, formatPercent } from '@/ui/format';

import { discardGuard, fileQuietly } from '../recording';

/**
 * Recording a treatment.
 *
 * The form does two things beyond taking the entry. It shows the withdrawal
 * the chosen method will start, because a method is often picked on efficacy
 * and the withdrawal is what decides whether the harvest slot survives. And it
 * shows what the count is expected to fall to, so that when the after count
 * comes in a fortnight later there is something to compare it against rather
 * than a vague sense that it should have worked.
 */
const props = defineProps<{
  readonly open: boolean;
  readonly view: PenView;
}>();

const emit = defineEmits<{ close: []; recorded: [] }>();

const { now } = useClock();
const record = useRecordTreatment();

const method = ref<TreatmentMethod>('thermal');
const beforeCount = ref('');
const note = ref('');

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    method.value = 'thermal';
    // The last count is the honest starting point for the before figure, and
    // unlike a lice sample it is a figure somebody already filed rather than
    // one this form would be inventing.
    const latest = props.view.lice.averages?.adultFemale;
    beforeCount.value = latest === undefined ? '' : latest.toFixed(2);
    note.value = '';
    record.reset();
  },
  // Immediate, because the parent mounts this with open already true: without
  // it the form is only ever reset on the second opening.
  { immediate: true },
);

const profile = computed(() => profileFor(method.value));

const before = computed(() => {
  const parsed = Number.parseFloat(beforeCount.value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
});

const expected = computed(() =>
  before.value === null ? null : projectedAfter(before.value, method.value),
);

const blocked = computed(() => props.view.blocking !== null);

const canRecord = computed(() => !record.isPending.value && props.view.position !== null);

const guard = discardGuard(
  () => note.value !== '' || beforeCount.value !== '',
  'Close without recording this treatment?',
);

async function save(): Promise<void> {
  if (!canRecord.value) return;

  const result = await fileQuietly(() =>
    record.mutateAsync({
      penId: String(props.view.pen.id),
      method: method.value,
      beforeCount: before.value,
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
    title="Record a treatment"
    :subtitle="`Pen ${view.pen.number}`"
    width="36rem"
    :before-close="guard"
    @close="emit('close')"
  >
    <form class="form" @submit.prevent="save">
      <label class="field">
        Method
        <select v-model="method" class="control">
          <option v-for="option in TREATMENTS" :key="option.method" :value="option.method">
            {{ option.label }}
          </option>
        </select>
      </label>

      <dl class="consequences">
        <div>
          <dt>Withdrawal</dt>
          <dd :class="{ heavy: profile.withdrawalDegreeDays > 0 }">
            {{
              profile.withdrawalDegreeDays === 0
                ? 'None, harvest unaffected'
                : `${profile.withdrawalDegreeDays} degree days`
            }}
          </dd>
        </div>
        <div>
          <dt>Typical reduction</dt>
          <dd>{{ formatPercent(profile.typicalEfficacy * 100, 0) }}</dd>
        </div>
        <div>
          <dt>Handling</dt>
          <dd>{{ profile.handles ? 'Crowds the pen' : 'No crowd needed' }}</dd>
        </div>
      </dl>

      <div class="fields">
        <label class="field">
          Count before
          <input
            v-model="beforeCount"
            class="control"
            type="number"
            step="0.01"
            min="0"
            inputmode="decimal"
          />
        </label>
        <label class="field wide">
          Note
          <input v-model="note" class="control" type="text" maxlength="200" />
        </label>
      </div>

      <p v-if="expected !== null" class="expected">
        On the usual reduction this pen should read about
        {{ formatNumber(expected, 2) }} adult female afterwards. Anything much above that is worth a
        resistance question rather than a second dose.
      </p>

      <p v-if="blocked" class="blocked">
        This pen is already inside a withdrawal. Recording another medicinal treatment extends it.
      </p>

      <p v-if="record.isError.value" class="failed" role="alert">
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
        {{ record.isPending.value ? 'Recording' : 'Record treatment' }}
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
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
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

.consequences {
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
  font-size: var(--type-sm);
}

.heavy {
  color: var(--caution);
}

.expected,
.blocked,
.failed {
  margin: 0;
  font-size: var(--type-sm);
}

.expected {
  color: var(--ink-secondary);
}

.blocked {
  color: var(--caution);
}

.failed {
  color: var(--fault);
}
</style>

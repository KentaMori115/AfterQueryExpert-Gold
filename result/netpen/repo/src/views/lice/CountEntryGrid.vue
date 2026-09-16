<script setup lang="ts">
import { computed } from 'vue';

import { averages, EMPTY_FISH, MINIMUM_SAMPLE, type FishCount } from '@/domain/lice/counts';
import { formatNumber } from '@/ui/format';

/**
 * The grid a lice count is actually entered on.
 *
 * A count is twenty fish, five stages each, entered by somebody standing over
 * a table with wet gloves on. So it is a grid of number inputs and nothing
 * else: no per fish dialogs, no adding rows one at a time, and the running
 * means along the bottom so a mistyped 10 in place of a 1 is visible before
 * the form is submitted rather than after the register has it.
 *
 * Tab order runs down a stage rather than across a fish, because that is the
 * order the counter works in. They do the adult females on all twenty fish,
 * then go back to the top.
 */
const props = defineProps<{
  readonly sample: readonly FishCount[];
}>();

const emit = defineEmits<{ 'update:sample': [readonly FishCount[]] }>();

const STAGES = [
  { key: 'adultFemale', label: 'Adult female' },
  { key: 'preAdult', label: 'Pre adult' },
  { key: 'adultMale', label: 'Adult male' },
  { key: 'chalimus', label: 'Chalimus' },
  { key: 'caligus', label: 'Caligus' },
] as const;

type Stage = (typeof STAGES)[number]['key'];

const means = computed(() => averages(props.sample));

const totals = computed(() =>
  props.sample.reduce(
    (total, fish) => total + fish.adultFemale + fish.preAdult + fish.adultMale + fish.chalimus,
    0,
  ),
);

function set(index: number, stage: Stage, raw: string): void {
  const parsed = Number.parseInt(raw, 10);
  const value = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  const next = props.sample.map((fish, position) =>
    position === index ? { ...fish, [stage]: value } : fish,
  );
  emit('update:sample', next);
}

function addFish(): void {
  emit('update:sample', [...props.sample, { ...EMPTY_FISH }]);
}

function removeFish(): void {
  if (props.sample.length <= 1) return;
  emit('update:sample', props.sample.slice(0, -1));
}
</script>

<template>
  <div class="grid">
    <table>
      <caption class="sr-only">
        Lice count, one column per fish and one row per stage
      </caption>
      <thead>
        <tr>
          <th scope="col" class="stage">Stage</th>
          <th v-for="(_, index) in sample" :key="index" scope="col">{{ index + 1 }}</th>
          <th scope="col" class="mean">Mean</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="stage in STAGES" :key="stage.key">
          <th scope="row" class="stage">{{ stage.label }}</th>
          <td v-for="(fish, index) in sample" :key="index">
            <input
              type="number"
              min="0"
              step="1"
              inputmode="numeric"
              :aria-label="`${stage.label}, fish ${index + 1}`"
              :value="fish[stage.key]"
              @input="set(index, stage.key, ($event.target as HTMLInputElement).value)"
            />
          </td>
          <td class="mean">{{ formatNumber(means?.[stage.key], 2) }}</td>
        </tr>
      </tbody>
    </table>

    <div class="foot">
      <span class="counted" :class="{ short: sample.length < MINIMUM_SAMPLE }">
        {{ sample.length }} of {{ MINIMUM_SAMPLE }} fish
        <template v-if="sample.length < MINIMUM_SAMPLE">
          , which is below what the regime asks for
        </template>
      </span>
      <span class="total">{{ totals }} lice on the table</span>
      <span class="buttons">
        <button type="button" @click="removeFish">Fewer</button>
        <button type="button" @click="addFish">More</button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.grid {
  display: flex;
  flex-direction: column;
  gap: var(--gap-3);
}

table {
  border-collapse: collapse;
  font-size: var(--type-sm);
}

th,
td {
  padding: 2px;
  text-align: center;
}

thead th {
  color: var(--ink-muted);
  font-size: var(--type-xs);
  font-weight: 400;
}

.stage {
  position: sticky;
  left: 0;
  padding-right: var(--gap-3);
  background: var(--surface-card);
  text-align: left;
  white-space: nowrap;
  font-weight: 400;
}

input {
  width: 2.6rem;
  padding: var(--gap-1);
  border: 1px solid var(--rule-hair);
  border-radius: var(--radius-xs);
  background: var(--surface-page);
  color: inherit;
  font: inherit;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.mean {
  padding-left: var(--gap-3);
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gap-3);
  color: var(--ink-muted);
  font-size: var(--type-xs);
}

.short {
  color: var(--caution);
}

.buttons {
  margin-left: auto;
  display: flex;
  gap: var(--gap-2);
}

button {
  padding: var(--gap-1) var(--gap-2);
  border: 1px solid var(--rule-firm);
  border-radius: var(--radius-xs);
  background: var(--surface-card);
  color: inherit;
  font: inherit;
  font-size: var(--type-xs);
  cursor: pointer;
}
</style>

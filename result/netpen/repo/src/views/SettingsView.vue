<script setup lang="ts">
import { computed } from 'vue';

import { useSite } from '@/app/queries';
import {
  BOARD_SORT_LABELS,
  REFRESH_CHOICES,
  STAGE_SHOWN_LABELS,
  usePreferences,
  type BoardSort,
  type LiceStageShown,
  type WeightUnit,
} from '@/app/stores/preferences';
import { APP_VERSION } from '@/app/version';
import type { TemperatureUnit } from '@/domain/units/water';
import BasePanel from '@/ui/BasePanel.vue';
import { formatNumber } from '@/ui/format';

import PageHeader from './PageHeader.vue';

/**
 * What this terminal shows.
 *
 * Everything here is display only, and the page says so, because on a shared
 * barge terminal the reasonable fear is that changing a setting changes a
 * stored figure. It does not: a lice limit is 0.5 adult females whatever the
 * screen is set to, and biomass is kept in kilogrammes whatever it is written
 * in.
 *
 * The refresh interval is the one setting with a cost attached, so it says
 * what the cost is. A terminal on a satellite link at thirty seconds is a
 * terminal spending its allowance on redrawing numbers that change weekly.
 */
const preferences = usePreferences();
const site = useSite();

const WEIGHT_UNITS: readonly { value: WeightUnit; label: string }[] = [
  { value: 'kg', label: 'Kilogrammes' },
  { value: 'g', label: 'Grams' },
];

const TEMPERATURE_UNITS: readonly { value: TemperatureUnit; label: string }[] = [
  { value: 'C', label: 'Celsius' },
  { value: 'F', label: 'Fahrenheit' },
];

const refreshLabel = computed(() =>
  preferences.refreshSeconds === 0
    ? 'Off, refresh by hand'
    : preferences.refreshSeconds < 60
      ? `Every ${preferences.refreshSeconds} seconds`
      : `Every ${formatNumber(preferences.refreshSeconds / 60, 0)} minutes`,
);
</script>

<template>
  <section class="settings">
    <PageHeader
      title="Settings"
      note="These change what this terminal shows and nothing else. No figure is converted in
        storage, and no limit moves: the register is kept in the units the regime writes it in."
    />

    <BasePanel title="Units">
      <div class="fields">
        <label>
          Weight
          <select
            class="control"
            :value="preferences.weightUnit"
            @change="
              preferences.setWeightUnit(($event.target as HTMLSelectElement).value as WeightUnit)
            "
          >
            <option v-for="option in WEIGHT_UNITS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label>
          Temperature
          <select
            class="control"
            :value="preferences.temperatureUnit"
            @change="
              preferences.setTemperatureUnit(
                ($event.target as HTMLSelectElement).value as TemperatureUnit,
              )
            "
          >
            <option v-for="option in TEMPERATURE_UNITS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
      </div>
    </BasePanel>

    <BasePanel title="The board">
      <div class="fields">
        <label>
          Default order
          <select
            class="control"
            :value="preferences.boardSort"
            @change="
              preferences.setBoardSort(($event.target as HTMLSelectElement).value as BoardSort)
            "
          >
            <option v-for="(label, value) in BOARD_SORT_LABELS" :key="value" :value="value">
              {{ label }}
            </option>
          </select>
        </label>
        <label>
          Lice stages shown
          <select
            class="control"
            :value="preferences.liceStageShown"
            @change="
              preferences.setLiceStageShown(
                ($event.target as HTMLSelectElement).value as LiceStageShown,
              )
            "
          >
            <option v-for="(label, value) in STAGE_SHOWN_LABELS" :key="value" :value="value">
              {{ label }}
            </option>
          </select>
        </label>
        <label class="check">
          <input
            type="checkbox"
            :checked="preferences.showEmptyPens"
            @change="preferences.setShowEmptyPens(($event.target as HTMLInputElement).checked)"
          />
          Show empty pens on the board
        </label>
      </div>
    </BasePanel>

    <BasePanel title="Refreshing" :subtitle="refreshLabel">
      <div class="fields">
        <label>
          Interval
          <select
            class="control"
            :value="preferences.refreshSeconds"
            @change="
              preferences.setRefreshSeconds(Number(($event.target as HTMLSelectElement).value))
            "
          >
            <option v-for="seconds in REFRESH_CHOICES" :key="seconds" :value="seconds">
              {{ seconds === 0 ? 'Off' : seconds < 60 ? `${seconds} s` : `${seconds / 60} min` }}
            </option>
          </select>
        </label>
      </div>
      <p class="hint">
        A site on a satellite link should leave this long. Nothing on these screens changes faster
        than the sea does, and a terminal refreshing every thirty seconds spends its allowance
        redrawing figures that move weekly.
      </p>
    </BasePanel>

    <BasePanel title="This site">
      <dl class="about">
        <div>
          <dt>Site</dt>
          <dd>{{ site.data.value?.name ?? 'Not loaded' }}</dd>
        </div>
        <div>
          <dt>Licence</dt>
          <dd>{{ site.data.value?.code ?? '' }}</dd>
        </div>
        <div>
          <dt>Regime</dt>
          <dd>{{ site.data.value?.regime ?? '' }}</dd>
        </div>
        <div>
          <dt>Build</dt>
          <dd>{{ APP_VERSION }}</dd>
        </div>
      </dl>
      <button type="button" class="control-button" @click="preferences.reset()">
        Put everything back to the defaults
      </button>
    </BasePanel>
  </section>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: var(--gap-4);
  max-width: 60rem;
}

.fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--gap-4);
}

label {
  display: flex;
  flex-direction: column;
  gap: var(--gap-1);
  color: var(--ink-muted);
  font-size: var(--type-xs);
}

.check {
  flex-direction: row;
  align-items: center;
  gap: var(--gap-2);
  color: var(--ink-primary);
  font-size: var(--type-sm);
}

.hint {
  margin: var(--gap-3) 0 0;
  max-width: 74ch;
  color: var(--ink-muted);
  font-size: var(--type-xs);
}

.about {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-5);
  margin: 0 0 var(--gap-4);
}

dt {
  color: var(--ink-muted);
  font-size: var(--type-xs);
}

dd {
  margin: 0;
  font-size: var(--type-sm);
}
</style>

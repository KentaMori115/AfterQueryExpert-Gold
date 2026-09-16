import { defineStore } from 'pinia';

import type { TemperatureUnit } from '@/domain/units/water';

/**
 * What the crew wants to look at.
 *
 * Display only. Nothing here changes a stored figure or how a limit is judged
 * against: a lice threshold is 0.5 adult females whatever the screen shows,
 * and biomass is kilogrammes whatever unit it is written in. That separation
 * is why this lives in the app layer and the domain never imports it.
 *
 * Persisted, because a barge terminal is shared and whoever picks it up next
 * should not have to set it up again.
 */

export type WeightUnit = 'g' | 'kg';
export type BoardSort = 'pen' | 'attention' | 'lice' | 'biomass';
export type LiceStageShown = 'adultFemale' | 'mobile' | 'all';

/**
 * Not readonly. This is store state and the actions below assign to it; a
 * readonly field here compiles in a test and fails the build, which is exactly
 * the sort of thing the type check exists to catch.
 */
export interface PreferencesState {
  weightUnit: WeightUnit;
  temperatureUnit: TemperatureUnit;
  boardSort: BoardSort;
  showEmptyPens: boolean;
  liceStageShown: LiceStageShown;
  /** Seconds between background refreshes. Zero switches them off. */
  refreshSeconds: number;
}

export const DEFAULT_PREFERENCES: PreferencesState = {
  weightUnit: 'kg',
  temperatureUnit: 'C',
  boardSort: 'attention',
  showEmptyPens: true,
  liceStageShown: 'adultFemale',
  refreshSeconds: 60,
};

export const REFRESH_CHOICES: readonly number[] = [0, 30, 60, 300, 900];

export const BOARD_SORT_LABELS: Record<BoardSort, string> = {
  pen: 'Pen number',
  attention: 'Needs attention first',
  lice: 'Lice, worst first',
  biomass: 'Biomass, largest first',
};

export const STAGE_SHOWN_LABELS: Record<LiceStageShown, string> = {
  adultFemale: 'Adult female only',
  mobile: 'Mobile stages',
  all: 'Every stage',
};

const STORAGE_KEY = 'netpen.preferences';

/**
 * Reading the store can throw outright in a private window or where site data
 * is blocked, so it is wrapped rather than merely defaulted. Losing a display
 * preference is not worth a blank page.
 */
function readStored(): Partial<PreferencesState> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Partial<PreferencesState>)
      : {};
  } catch {
    return {};
  }
}

function writeStored(state: PreferencesState): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A terminal with storage blocked still works, it just forgets.
  }
}

export const usePreferences = defineStore('preferences', {
  state: (): PreferencesState => ({ ...DEFAULT_PREFERENCES, ...readStored() }),

  getters: {
    /** Whether the board should refresh on its own at all. */
    autoRefresh: (state): boolean => state.refreshSeconds > 0,
    refreshMs: (state): number => state.refreshSeconds * 1_000,
  },

  actions: {
    setWeightUnit(unit: WeightUnit) {
      this.weightUnit = unit;
      this.persist();
    },
    setTemperatureUnit(unit: TemperatureUnit) {
      this.temperatureUnit = unit;
      this.persist();
    },
    setBoardSort(sort: BoardSort) {
      this.boardSort = sort;
      this.persist();
    },
    setShowEmptyPens(show: boolean) {
      this.showEmptyPens = show;
      this.persist();
    },
    setLiceStageShown(stage: LiceStageShown) {
      this.liceStageShown = stage;
      this.persist();
    },
    setRefreshSeconds(seconds: number) {
      this.refreshSeconds = seconds;
      this.persist();
    },
    reset() {
      this.$patch({ ...DEFAULT_PREFERENCES });
      this.persist();
    },
    persist() {
      writeStored(this.$state);
    },
  },
});

/** Clear stored preferences, so one test cannot leak into the next. */
export function clearStoredPreferences(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear if it was never readable.
  }
}

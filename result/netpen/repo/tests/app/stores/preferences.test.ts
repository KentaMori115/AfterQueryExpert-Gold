import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BOARD_SORT_LABELS,
  clearStoredPreferences,
  DEFAULT_PREFERENCES,
  REFRESH_CHOICES,
  STAGE_SHOWN_LABELS,
  usePreferences,
} from '@/app/stores/preferences';

beforeEach(() => {
  clearStoredPreferences();
  setActivePinia(createPinia());
});

afterEach(() => {
  clearStoredPreferences();
  vi.restoreAllMocks();
});

describe('defaults', () => {
  it('starts on the defaults', () => {
    const preferences = usePreferences();
    expect(preferences.$state).toEqual(DEFAULT_PREFERENCES);
  });

  it('sorts the board by what needs attention', () => {
    expect(usePreferences().boardSort).toBe('attention');
  });

  it('names every sort and every stage choice', () => {
    expect(Object.keys(BOARD_SORT_LABELS)).toHaveLength(4);
    expect(Object.keys(STAGE_SHOWN_LABELS)).toHaveLength(3);
  });
});

describe('changing a preference', () => {
  it('holds the new value', () => {
    const preferences = usePreferences();
    preferences.setWeightUnit('g');
    preferences.setTemperatureUnit('F');
    preferences.setBoardSort('lice');
    expect(preferences.weightUnit).toBe('g');
    expect(preferences.temperatureUnit).toBe('F');
    expect(preferences.boardSort).toBe('lice');
  });

  it('toggles the empty pens and the stage shown', () => {
    const preferences = usePreferences();
    preferences.setShowEmptyPens(false);
    preferences.setLiceStageShown('all');
    expect(preferences.showEmptyPens).toBe(false);
    expect(preferences.liceStageShown).toBe('all');
  });

  it('resets everything back', () => {
    const preferences = usePreferences();
    preferences.setWeightUnit('g');
    preferences.setShowEmptyPens(false);
    preferences.reset();
    expect(preferences.$state).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('the refresh interval', () => {
  it('offers the choices the settings screen shows', () => {
    expect(REFRESH_CHOICES).toContain(0);
    expect(REFRESH_CHOICES).toContain(60);
  });

  it('reports whether it refreshes at all', () => {
    const preferences = usePreferences();
    expect(preferences.autoRefresh).toBe(true);
    expect(preferences.refreshMs).toBe(60_000);

    preferences.setRefreshSeconds(0);
    expect(preferences.autoRefresh).toBe(false);
    expect(preferences.refreshMs).toBe(0);
  });
});

describe('persistence', () => {
  it('writes a change out', () => {
    usePreferences().setBoardSort('biomass');
    expect(globalThis.localStorage.getItem('netpen.preferences')).toContain('biomass');
  });

  it('reads a stored value back on a fresh store', () => {
    usePreferences().setWeightUnit('g');
    setActivePinia(createPinia());
    expect(usePreferences().weightUnit).toBe('g');
  });

  it('falls back to the defaults on a corrupt store', () => {
    globalThis.localStorage.setItem('netpen.preferences', 'not json');
    setActivePinia(createPinia());
    expect(usePreferences().$state).toEqual(DEFAULT_PREFERENCES);
  });

  it('still works where storage throws outright', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    setActivePinia(createPinia());
    const preferences = usePreferences();
    expect(preferences.$state).toEqual(DEFAULT_PREFERENCES);
    expect(() => preferences.setBoardSort('pen')).not.toThrow();
    expect(preferences.boardSort).toBe('pen');
  });
});

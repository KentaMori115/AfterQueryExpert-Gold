import { setActivePinia } from 'pinia';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearStoredPreferences,
  DEFAULT_PREFERENCES,
  usePreferences,
} from '@/app/stores/preferences';
import { APP_VERSION } from '@/app/version';
import type { Site } from '@/domain/site/types';
import SettingsView from '@/views/SettingsView.vue';

import { mountView, settle } from '../support/mount';

const SITE = {
  name: 'Eilean Dubh',
  code: 'FS-0412',
  regime: 'scotland',
} as Site;

async function page() {
  const { wrapper } = await mountView(SettingsView, {
    path: '/settings',
    api: { getSite: () => Promise.resolve(SITE) },
  });
  await settle(wrapper, 6);
  return wrapper;
}

function selectNamed(wrapper: Awaited<ReturnType<typeof page>>, label: string) {
  return wrapper
    .findAll('label')
    .find((node) => node.text().startsWith(label))!
    .find('select');
}

afterEach(() => {
  clearStoredPreferences();
  setActivePinia(undefined);
});

describe('what the page says it does', () => {
  it('states that nothing here changes a stored figure', async () => {
    const wrapper = await page();
    expect(wrapper.find('.note').text()).toContain('No figure is converted in storage');
  });
});

describe('units', () => {
  it('shows the unit the terminal is set to', async () => {
    const wrapper = await page();
    expect((selectNamed(wrapper, 'Weight').element as HTMLSelectElement).value).toBe('kg');
  });

  it('stores a change so the next person finds it set', async () => {
    const wrapper = await page();
    await selectNamed(wrapper, 'Temperature').setValue('F');
    expect(usePreferences().temperatureUnit).toBe('F');
  });
});

describe('the board defaults', () => {
  it('offers every order the board understands', async () => {
    const wrapper = await page();
    const options = selectNamed(wrapper, 'Default order')
      .findAll('option')
      .map((option) => option.text());
    expect(options).toContain('Needs attention first');
    expect(options).toContain('Pen number');
  });

  it('changes the order the board will open on', async () => {
    const wrapper = await page();
    await selectNamed(wrapper, 'Default order').setValue('biomass');
    expect(usePreferences().boardSort).toBe('biomass');
  });

  it('carries the empty pen choice, which the board also offers', async () => {
    const wrapper = await page();
    await wrapper.find('input[type="checkbox"]').setValue(false);
    expect(usePreferences().showEmptyPens).toBe(false);
  });
});

describe('refreshing', () => {
  it('says what the current interval means in words', async () => {
    const wrapper = await page();
    expect(wrapper.text()).toContain('Every 1 minutes');
  });

  it('says it is off rather than showing a zero', async () => {
    const wrapper = await page();
    await selectNamed(wrapper, 'Interval').setValue('0');
    expect(wrapper.text()).toContain('Off, refresh by hand');
  });

  it('says what a short interval costs on a satellite link', async () => {
    const wrapper = await page();
    expect(wrapper.find('.hint').text()).toContain('satellite link');
  });
});

describe('about this site', () => {
  it('names the site and its licence', async () => {
    const wrapper = await page();
    expect(wrapper.find('.about').text()).toContain('Eilean Dubh');
    expect(wrapper.find('.about').text()).toContain('FS-0412');
  });

  it('names the regime, since it decides the lice limits', async () => {
    const wrapper = await page();
    expect(wrapper.find('.about').text()).toContain('scotland');
  });

  it('carries the build, so a bug report can name it', async () => {
    const wrapper = await page();
    expect(wrapper.find('.about').text()).toContain(APP_VERSION);
  });
});

describe('putting it back', () => {
  it('restores every default at once', async () => {
    const wrapper = await page();
    await selectNamed(wrapper, 'Default order').setValue('biomass');
    await selectNamed(wrapper, 'Temperature').setValue('F');

    await wrapper.find('button.control-button').trigger('click');

    const preferences = usePreferences();
    expect(preferences.boardSort).toBe(DEFAULT_PREFERENCES.boardSort);
    expect(preferences.temperatureUnit).toBe(DEFAULT_PREFERENCES.temperatureUnit);
  });
});

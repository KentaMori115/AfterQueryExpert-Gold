import { setActivePinia } from 'pinia';
import { afterEach, describe, expect, it } from 'vitest';

import { SHORTCUTS } from '@/app/shortcuts';
import { clearStoredPreferences } from '@/app/stores/preferences';
import { APP_VERSION } from '@/app/version';
import App from '@/App.vue';
import type { PenBoardRow } from '@/data/api';
import type { Person } from '@/data/fixtures/site';
import type { Alert } from '@/domain/alerts/types';
import type { Site } from '@/domain/site/types';
import type { Generation } from '@/domain/stock/types';

import { alert } from './support/alerts';
import { mountView, settle } from './support/mount';
import { penView, TEST_NOW } from './support/penView';

const SITE = { name: 'Eilean Dubh', code: 'FS-0412', regime: 'scotland' } as Site;
const GENERATION = { code: 'S24', firstStockedAt: TEST_NOW - 330 * 86_400_000 } as Generation;
const PEOPLE = [{ id: 'per-tait', name: 'A. Tait', initials: 'AT' }] as unknown as Person[];

function board(): PenBoardRow[] {
  return [
    { view: penView({ number: 1, countedAt: TEST_NOW - 2 * 86_400_000 }), alerts: [] },
    { view: penView({ number: 2, countedAt: TEST_NOW - 9 * 86_400_000 }), alerts: [] },
  ];
}

async function shell(alerts: Alert[] = []) {
  const { wrapper } = await mountView(App, {
    path: '/pens',
    api: {
      getSite: () => Promise.resolve(SITE),
      getGeneration: () => Promise.resolve(GENERATION),
      listPeople: () => Promise.resolve(PEOPLE),
      listAlerts: () => Promise.resolve(alerts),
      listPenBoard: () => Promise.resolve(board()),
    },
  });
  await settle(wrapper, 10);
  return wrapper;
}

afterEach(() => {
  clearStoredPreferences();
  setActivePinia(undefined);
});

describe('the shell', () => {
  it('names the site and the generation in the rail', async () => {
    const wrapper = await shell();
    expect(wrapper.text()).toContain('Eilean Dubh');
    expect(wrapper.text()).toContain('S24');
  });

  it('carries a skip link ahead of the rail', async () => {
    const wrapper = await shell();
    expect(wrapper.find('.skip').attributes('href')).toBe('#main');
    expect(wrapper.find('#main').exists()).toBe(true);
  });

  it('titles the page from the route', async () => {
    const wrapper = await shell();
    expect(wrapper.text()).toContain('Pens');
  });

  it('names the build, so a report can quote it', async () => {
    const wrapper = await shell();
    expect(wrapper.text()).toContain(APP_VERSION);
  });
});

describe('the alert count', () => {
  it('counts only what still needs somebody', async () => {
    const wrapper = await shell([
      alert({ id: 'a', penNumber: 1 }),
      alert({ id: 'b', penNumber: 2, acknowledgedAt: TEST_NOW, acknowledgedBy: 'A. Tait' }),
      alert({ id: 'c', penNumber: 3, clearedAt: TEST_NOW }),
    ]);
    expect(wrapper.find('.rail .count').text()).toBe('1');
  });

  it('shows nothing rather than a zero when the site is quiet', async () => {
    const wrapper = await shell();
    expect(wrapper.find('.rail .count').exists()).toBe(false);
  });
});

describe('the freshest count', () => {
  it('takes the most recent count across every pen, not the first one it sees', async () => {
    const wrapper = await shell();
    // Two days old rather than nine.
    expect(wrapper.text()).toMatch(/2 days|2d/);
  });
});

describe('the keys', () => {
  it('keeps the list shut until it is asked for', async () => {
    const wrapper = await shell();
    expect(wrapper.find('.keyList').exists()).toBe(false);
    expect(wrapper.find('.keysToggle').attributes('aria-expanded')).toBe('false');
  });

  it('lists every shortcut when opened', async () => {
    const wrapper = await shell();
    await wrapper.find('.keysToggle').trigger('click');
    expect(wrapper.findAll('.keyList li')).toHaveLength(SHORTCUTS.length);
    expect(wrapper.find('.keyList kbd').text()).toBe('p');
  });
});

import { setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearStoredPreferences } from '@/app/stores/preferences';
import type { Person } from '@/data/fixtures/site';
import type { Alert } from '@/domain/alerts/types';
import AlertsView from '@/views/AlertsView.vue';

import { alert } from '../support/alerts';
import { mountView, settle } from '../support/mount';
import { TEST_NOW } from '../support/penView';

const DAY = 86_400_000;
const PEOPLE = [{ id: 'per-tait', name: 'A. Tait' }] as unknown as Person[];

const ALERTS = [
  alert({ id: 'a-info', kind: 'net-due-for-change', severity: 'info', penNumber: 2 }),
  alert({ id: 'a-urgent', kind: 'lice-over-limit', severity: 'urgent', penNumber: 3 }),
  alert({
    id: 'a-taken',
    kind: 'oxygen-low',
    severity: 'warning',
    penNumber: 4,
    acknowledgedAt: TEST_NOW - DAY,
    acknowledgedBy: 'R. Lamont',
  }),
  alert({ id: 'a-cleared', kind: 'mortality-elevated', penNumber: 5, clearedAt: TEST_NOW - DAY }),
];

async function page(
  alerts: Alert[] = ALERTS,
  acknowledgeAlert = vi.fn(() => Promise.resolve(alerts[0]!)),
) {
  const { wrapper } = await mountView(AlertsView, {
    path: '/alerts',
    api: {
      listAlerts: () => Promise.resolve(alerts),
      listPeople: () => Promise.resolve(PEOPLE),
      acknowledgeAlert,
    },
  });
  await settle(wrapper, 8);
  return { wrapper, acknowledgeAlert };
}

afterEach(() => {
  clearStoredPreferences();
  setActivePinia(undefined);
});

describe('the order', () => {
  it('leads with the urgent one, whatever time it was raised', async () => {
    const { wrapper } = await page();
    expect(wrapper.find('li.row').classes()).toContain('urgent');
  });
});

describe('the filters', () => {
  it('starts on the alerts nobody has taken on', async () => {
    const { wrapper } = await page();
    const ids = wrapper.findAll('li.row').map((row) => row.text());
    expect(ids.some((text) => text.includes('Lice over the limit'))).toBe(true);
    expect(ids.some((text) => text.includes('Oxygen low'))).toBe(false);
  });

  it('shows acknowledged alerts under open, since they are not finished', async () => {
    const { wrapper } = await page();
    await wrapper.findAll('.filters button')[1]!.trigger('click');
    expect(wrapper.findAll('li.row')).toHaveLength(3);
  });

  it('brings the cleared ones back under everything raised', async () => {
    const { wrapper } = await page();
    await wrapper.findAll('.filters button')[2]!.trigger('click');
    expect(wrapper.findAll('li.row')).toHaveLength(4);
    expect(wrapper.find('.row.cleared').exists()).toBe(true);
  });

  it('marks which filter is on for a screen reader as well as for the eye', async () => {
    const { wrapper } = await page();
    const first = wrapper.findAll('.filters button')[0]!;
    expect(first.attributes('aria-pressed')).toBe('true');
  });

  it('says everything is covered rather than showing an empty list', async () => {
    const { wrapper } = await page([
      alert({ id: 'a-taken', acknowledgedAt: TEST_NOW, acknowledgedBy: 'A. Tait' }),
    ]);
    expect(wrapper.text()).toContain('Every open alert has somebody on it');
  });
});

describe('the counts', () => {
  it('counts urgent, regulatory, unclaimed and taken separately', async () => {
    const { wrapper } = await page();
    const tiles = wrapper.findAll('.strip > *').map((tile) => tile.text());
    expect(tiles[0]).toContain('1');
    expect(tiles[1]).toContain('1');
    expect(tiles[3]).toContain('1');
  });

  it('leaves cleared alerts out of the counts', async () => {
    const { wrapper } = await page([alert({ clearedAt: TEST_NOW - DAY, severity: 'urgent' })]);
    expect(wrapper.findAll('.strip > *')[0]?.text()).toContain('0');
  });
});

describe('taking one on', () => {
  it('records who took it', async () => {
    const { wrapper, acknowledgeAlert } = await page();
    await wrapper.find('li.row button').trigger('click');
    await settle(wrapper, 6);
    expect(acknowledgeAlert).toHaveBeenCalledWith('a-urgent', 'per-tait', expect.any(Number));
  });

  it('marks that one as working rather than the whole list', async () => {
    let release = (): void => {};
    const acknowledgeAlert = vi.fn(
      () =>
        new Promise<Alert>((resolve) => {
          release = () => resolve(ALERTS[0]!);
        }),
    );
    const { wrapper } = await page(ALERTS, acknowledgeAlert);
    await wrapper.find('li.row button').trigger('click');
    await settle(wrapper, 2);

    const buttons = wrapper.findAll('li.row button');
    expect(buttons[0]!.text()).toBe('Taking');
    release();
  });
});

describe('the footer', () => {
  it('says the cleared ones are kept rather than deleted', async () => {
    const { wrapper } = await page();
    expect(wrapper.find('.foot').text()).toContain('kept, not deleted');
  });
});

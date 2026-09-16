import { setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearStoredPreferences, usePreferences } from '@/app/stores/preferences';
import { RefusedError, type PenBoardRow } from '@/data/api';
import type { PenView } from '@/data/projections/pen';
import PenBoardView from '@/views/PenBoardView.vue';

import { mountView, settle } from '../support/mount';
import { emptyPen, penView } from '../support/penView';

function row(view: PenView, alerts = 0): PenBoardRow {
  return {
    view,
    alerts: Array.from({ length: alerts }, () => ({}) as PenBoardRow['alerts'][number]),
  };
}

const BOARD: PenBoardRow[] = [
  row(penView({ number: 1, count: 50_000, meanWeightG: 4_000, adultFemale: 0.04 })),
  row(penView({ number: 2, adultFemale: 0.44, liceStatus: 'over-limit' }), 2),
  row(emptyPen(3)),
];

async function board(rows: PenBoardRow[] = BOARD) {
  const { wrapper } = await mountView(PenBoardView, {
    path: '/pens',
    api: { listPenBoard: () => Promise.resolve(rows) },
  });
  await settle(wrapper);
  return wrapper;
}

afterEach(() => {
  clearStoredPreferences();
  setActivePinia(undefined);
});

describe('the board', () => {
  it('draws a card per pen once the board arrives', async () => {
    expect((await board()).findAll('.card')).toHaveLength(3);
  });

  it('shows a skeleton before anything arrives, not an empty grid', async () => {
    const { wrapper } = await mountView(PenBoardView, {
      path: '/pens',
      api: { listPenBoard: () => new Promise<PenBoardRow[]>(() => {}) },
    });
    expect(wrapper.findAll('.card')).toHaveLength(0);
    expect(wrapper.find('[role="status"] .bar').exists()).toBe(true);
  });

  it('says the licence has no pens rather than showing an empty grid', async () => {
    const wrapper = await board([]);
    expect(wrapper.text()).toContain('No pens on this site');
  });

  it('offers a retry when the request fails', async () => {
    // A refusal rather than a dropped link, so the client does not sit through
    // three backed off retries before the screen says anything.
    const listPenBoard = vi.fn(() => Promise.reject(new RefusedError('no', 'role-not-permitted')));
    const { wrapper } = await mountView(PenBoardView, {
      path: '/pens',
      api: { listPenBoard },
    });
    await settle(wrapper, 12);
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.find('button.retry').exists()).toBe(true);
  });
});

describe('the summary strip', () => {
  it('totals the site rather than a pen', async () => {
    const text = (await board()).find('.strip').text();
    expect(text).toContain('392.0');
    expect(text).toContain('110,000 fish in 2 pens');
  });

  it('reports the worst lice figure on the site', async () => {
    expect((await board()).find('.strip').text()).toContain('0.44');
  });

  it('adds up open alerts across every pen', async () => {
    const wrapper = await board([row(penView({ number: 1 }), 2), row(penView({ number: 2 }), 3)]);
    const tile = wrapper.findAll('.strip > *').at(-1);
    expect(tile?.text()).toContain('5');
  });
});

describe('ordering', () => {
  it('leads with the pen that needs somebody', async () => {
    const wrapper = await board();
    usePreferences().setBoardSort('attention');
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('.card')[0]?.text()).toContain('Pen 2');
  });

  it('follows the mooring grid when asked for pen number', async () => {
    const wrapper = await board();
    usePreferences().setBoardSort('pen');
    await wrapper.vm.$nextTick();
    const numbers = wrapper.findAll('.card h3').map((node) => node.text().replace(/\D/g, ''));
    expect(numbers).toEqual(['1', '2', '3']);
  });

  it('reads the order out of preferences rather than local state', async () => {
    const wrapper = await board();
    const select = wrapper.find('select');
    await select.setValue('biomass');
    expect(usePreferences().boardSort).toBe('biomass');
    expect(wrapper.findAll('.card')[0]?.text()).toContain('Pen 1');
  });
});

describe('empty pens', () => {
  it('can be hidden without losing them from the totals', async () => {
    const wrapper = await board();
    await wrapper.find('input[type="checkbox"]').setValue(false);
    expect(wrapper.findAll('.card')).toHaveLength(2);
    expect(wrapper.find('.strip').text()).toContain('110,000 fish');
  });

  it('remembers the choice, since the terminal is shared', async () => {
    const wrapper = await board();
    await wrapper.find('input[type="checkbox"]').setValue(false);
    expect(usePreferences().showEmptyPens).toBe(false);
  });
});

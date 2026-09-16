import { describe, expect, it } from 'vitest';

import type { PenView } from '@/data/projections/pen';
import FeedTable from '@/views/feed/FeedTable.vue';

import { mountView } from '../../support/mount';
import { emptyPen, penView } from '../../support/penView';

async function table(pens: PenView[]) {
  const { wrapper } = await mountView(FeedTable, { props: { pens } });
  return wrapper;
}

const PENS = [
  penView({
    number: 1,
    count: 50_000,
    meanWeightG: 4_000,
    saturationPercent: 96,
    temperatureC: 11,
  }),
  penView({ number: 2, count: 40_000, meanWeightG: 1_600, saturationPercent: 68 }),
];

describe('the sheet', () => {
  it('carries a row per stocked pen', async () => {
    expect((await table(PENS)).findAll('tbody tr')).toHaveLength(2);
  });

  it('leaves empty pens off, since there is nothing to load for them', async () => {
    const wrapper = await table([penView({ number: 1 }), emptyPen(2)]);
    expect(wrapper.findAll('tbody tr')).toHaveLength(1);
  });

  it('says why there is nothing rather than showing a bare table', async () => {
    const wrapper = await table([emptyPen(1)]);
    expect(wrapper.text()).toContain('Nothing to feed');
  });

  it('links each row through to the pen', async () => {
    const wrapper = await table(PENS);
    expect(wrapper.find('tbody a').attributes('href')).toBe('/pens/pen-1');
  });
});

describe('the ration', () => {
  it('gives what the table says as well as what is going out', async () => {
    const wrapper = await table(PENS);
    const headers = wrapper.findAll('thead th').map((th) => th.text());
    expect(headers).toContain('To table');
    expect(headers).toContain('Ration');
  });

  it('marks a pen that is being held back', async () => {
    const wrapper = await table(PENS);
    const held = wrapper.findAll('tbody .held');
    expect(held).toHaveLength(1);
  });

  it('names the constraint that is doing the holding', async () => {
    const wrapper = await table(PENS);
    expect(wrapper.find('tbody .badge').text()).toBe('Held back by oxygen');
  });

  it('leaves the reason blank on a pen feeding to table', async () => {
    const wrapper = await table([PENS[0]!]);
    expect(wrapper.find('tbody .clear').text()).toBe('—');
  });

  it('gives the rate as a percentage of body weight', async () => {
    const wrapper = await table([PENS[0]!]);
    expect(wrapper.find('tbody').text()).toMatch(/\d\.\d\d %/);
  });
});

describe('the pellet', () => {
  it('works the size out from the fish in the pen', async () => {
    const wrapper = await table(PENS);
    const sizes = wrapper.findAll('tbody tr').map((row) => row.findAll('td')[2]!.text());
    expect(new Set(sizes).size).toBe(2);
  });

  it('lists the sizes the barge has to carry', async () => {
    const wrapper = await table(PENS);
    expect(wrapper.find('.totals').text()).toMatch(/\d+ mm, \d+ mm/);
  });
});

describe('the totals', () => {
  it('adds up what is being loaded today', async () => {
    const wrapper = await table(PENS);
    expect(wrapper.find('.totals').text()).toContain('Loading today');
  });

  it('puts the load against what the table would have asked for', async () => {
    const wrapper = await table(PENS);
    expect(wrapper.find('.totals').text()).toMatch(/\d+ % of it/);
  });

  it('counts the pens held back, and marks the count when there are any', async () => {
    const wrapper = await table(PENS);
    expect(wrapper.find('.totals .held').text()).toBe('1');
  });

  it('leaves the count unmarked when nothing is held back', async () => {
    const wrapper = await table([PENS[0]!]);
    expect(wrapper.find('.totals .held').exists()).toBe(false);
  });
});

describe('sorting', () => {
  it('can be sorted by ration, largest first, for loading order', async () => {
    const wrapper = await table(PENS);
    const header = wrapper.findAll('thead th')[4]!;
    await header.trigger('click');
    await header.trigger('click');

    const pens = wrapper.findAll('tbody tr td:first-child').map((cell) => cell.text());
    expect(pens[0]).toBe('Pen 1');
  });
});

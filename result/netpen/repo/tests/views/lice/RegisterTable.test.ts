import { describe, expect, it } from 'vitest';

import type { PenView } from '@/data/projections/pen';
import type { Regime } from '@/domain/lice/thresholds';
import RegisterTable from '@/views/lice/RegisterTable.vue';

import { mountView } from '../../support/mount';
import { emptyPen, penView, TEST_NOW } from '../../support/penView';

const DAY = 86_400_000;

async function table(pens: PenView[], regime: Regime = 'norway') {
  const { wrapper } = await mountView(RegisterTable, {
    props: { pens, regime, now: TEST_NOW },
  });
  return wrapper;
}

function cells(wrapper: Awaited<ReturnType<typeof table>>, row: number) {
  return wrapper
    .findAll('tbody tr')
    [row]!.findAll('td')
    .map((cell) => cell.text());
}

describe('the rows', () => {
  it('carries a row per pen, in pen order', async () => {
    const wrapper = await table([penView({ number: 3 }), penView({ number: 1 })]);
    const numbers = wrapper.findAll('tbody tr td:first-child').map((cell) => cell.text());
    expect(numbers).toEqual(['Pen 1', 'Pen 3']);
  });

  it('keeps an uncounted pen as a row, since that is what an audit finds', async () => {
    const wrapper = await table([penView({ number: 2, adultFemale: null, countedAt: null })]);
    expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    expect(wrapper.find('.never').text()).toBe('Never');
  });

  it('links every row through to the pen', async () => {
    const wrapper = await table([penView({ number: 5 })]);
    expect(wrapper.find('tbody a').attributes('href')).toBe('/pens/pen-5');
  });

  it('shows both the regulated stage and the mobile total', async () => {
    const wrapper = await table([
      penView({ number: 1, sample: [{ adultFemale: 2, preAdult: 3, adultMale: 1 }] }),
    ]);
    const row = cells(wrapper, 0);
    expect(row[1]).toBe('2.00');
    expect(row[2]).toBe('6.00');
  });
});

describe('the limit', () => {
  it('is the limit that applied the week the count was taken', async () => {
    const spring = await table([penView({ countedAt: Date.UTC(2025, 3, 30) })]);
    expect(cells(spring, 0)[3]).toBe('0.20');

    const summer = await table([penView({ countedAt: Date.UTC(2025, 6, 22) })]);
    expect(cells(summer, 0)[3]).toBe('0.50');
  });

  it('does not tighten in spring under the Scottish rule', async () => {
    const wrapper = await table([penView({ countedAt: Date.UTC(2025, 3, 30) })], 'scotland');
    expect(cells(wrapper, 0)[3]).toBe('0.50');
  });

  it('marks a count that is over the limit it was taken against', async () => {
    const wrapper = await table([
      penView({ number: 1, adultFemale: 0.62 }),
      penView({ number: 2, adultFemale: 0.11 }),
    ]);
    const marked = wrapper.findAll('.over').map((node) => node.text());
    expect(marked).toEqual(['0.62']);
  });
});

describe('when the count was taken', () => {
  it('says who took it', async () => {
    const wrapper = await table([penView({ countedBy: 'R. Lamont' })]);
    expect(wrapper.text()).toContain('R. Lamont');
  });

  it('marks a count that has gone stale and says how stale', async () => {
    const wrapper = await table([penView({ countedAt: TEST_NOW - 14 * DAY })]);
    expect(wrapper.find('.stale').exists()).toBe(true);
    expect(wrapper.find('.ago').text()).toBe('14 days ago');
  });

  it('leaves a fresh count unmarked', async () => {
    const wrapper = await table([penView({ countedAt: TEST_NOW - 2 * DAY })]);
    expect(wrapper.find('.stale').exists()).toBe(false);
    expect(wrapper.find('.ago').exists()).toBe(false);
  });
});

describe('status and actions', () => {
  it('marks an empty pen as empty rather than as clear', async () => {
    const wrapper = await table([emptyPen(4)]);
    expect(wrapper.find('tbody .badge').text()).toBe('Empty');
  });

  it('offers a count on a stocked pen only', async () => {
    const wrapper = await table([penView({ number: 1 }), emptyPen(2)]);
    const buttons = wrapper.findAll('tbody button');
    expect(buttons).toHaveLength(1);
  });

  it('asks the parent to open the form, naming the pen', async () => {
    const wrapper = await table([penView({ number: 7 })]);
    await wrapper.find('tbody button').trigger('click');
    expect(wrapper.emitted('count')?.[0]).toEqual(['pen-7']);
  });
});

describe('sorting', () => {
  it('can be sorted by the count, with uncounted pens at the bottom', async () => {
    const wrapper = await table([
      penView({ number: 1, adultFemale: 0.1 }),
      penView({ number: 2, adultFemale: null, countedAt: null }),
      penView({ number: 3, adultFemale: 0.5 }),
    ]);
    const header = wrapper.findAll('thead th')[1]!;
    await header.trigger('click');
    await header.trigger('click');

    const numbers = wrapper.findAll('tbody tr td:first-child').map((cell) => cell.text());
    expect(numbers).toEqual(['Pen 3', 'Pen 1', 'Pen 2']);
  });
});

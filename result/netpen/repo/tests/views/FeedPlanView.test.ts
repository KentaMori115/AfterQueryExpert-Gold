import { setActivePinia } from 'pinia';
import { afterEach, describe, expect, it } from 'vitest';

import { clearStoredPreferences } from '@/app/stores/preferences';
import type { PenView } from '@/data/projections/pen';
import type { SiteView } from '@/data/projections/site';
import type { Generation } from '@/domain/stock/types';
import FeedPlanView from '@/views/FeedPlanView.vue';

import { mountView, settle } from '../support/mount';
import { emptyPen, penView, TEST_NOW } from '../support/penView';

const GENERATION = { budgetFcr: 1.18, code: 'S24' } as Generation;

const PENS = [
  penView({
    number: 1,
    count: 50_000,
    meanWeightG: 4_000,
    temperatureC: 11,
    saturationPercent: 96,
  }),
  penView({ number: 2, count: 40_000, meanWeightG: 1_600, saturationPercent: 68 }),
];

async function page(pens: PenView[] = PENS) {
  const { wrapper } = await mountView(FeedPlanView, {
    path: '/feed',
    api: {
      getSiteView: () => Promise.resolve({ at: TEST_NOW, pens } as unknown as SiteView),
      getGeneration: () => Promise.resolve(GENERATION),
    },
  });
  await settle(wrapper, 8);
  return wrapper;
}

afterEach(() => {
  clearStoredPreferences();
  setActivePinia(undefined);
});

describe('the summary strip', () => {
  it('says how much is going on the barge and across how many pens', async () => {
    const wrapper = await page();
    const strip = wrapper.find('.strip').text();
    expect(strip).toContain('Loading today');
    expect(strip).toContain('Across 2 pens');
  });

  it('puts the load against what the table asks for', async () => {
    const wrapper = await page();
    expect(wrapper.findAll('.strip > *')[1]?.text()).toMatch(/Table asks for \d+ kg/);
  });

  it('marks the site as held back when it is well under table', async () => {
    const wrapper = await page([
      penView({ number: 1, saturationPercent: 62 }),
      penView({ number: 2, saturationPercent: 60 }),
    ]);
    expect(wrapper.findAll('.strip > *')[1]?.classes()).toContain('caution');
  });

  it('weights the site rate by biomass rather than averaging pen rates', async () => {
    const wrapper = await page();
    const rate = wrapper.findAll('.strip > *')[2]?.text() ?? '';
    expect(rate).toMatch(/\d\.\d\d/);
    expect(rate).toContain('weighted by biomass');
  });

  it('converts the load into growth at the budget ratio', async () => {
    const wrapper = await page();
    expect(wrapper.findAll('.strip > *')[3]?.text()).toContain('budget ratio of 1.18');
  });

  it('says the ratio is unknown rather than inventing one', async () => {
    const { wrapper } = await mountView(FeedPlanView, {
      path: '/feed',
      api: {
        getSiteView: () => Promise.resolve({ at: TEST_NOW, pens: PENS } as unknown as SiteView),
        getGeneration: () => new Promise<Generation>(() => {}),
      },
    });
    await settle(wrapper, 8);
    expect(wrapper.findAll('.strip > *')[3]?.text()).toContain('Budget ratio unknown');
  });
});

describe('the table', () => {
  it('counts how many pens are held back in the panel subtitle', async () => {
    const wrapper = await page();
    expect(wrapper.find('.subtitle').text()).toBe('1 of 2 pens held back');
  });

  it('says every pen is feeding to table when none is held', async () => {
    const wrapper = await page([PENS[0]!]);
    expect(wrapper.find('.subtitle').text()).toBe('Every pen feeding to table');
    expect(wrapper.find('.panel').classes()).not.toContain('caution');
  });

  it('shows the sheet itself, not a summary of it', async () => {
    const wrapper = await page();
    expect(wrapper.findAll('tbody tr')).toHaveLength(2);
  });

  it('copes with a site where nothing is stocked', async () => {
    const wrapper = await page([emptyPen(1), emptyPen(2)]);
    expect(wrapper.text()).toContain('Nothing to feed');
    expect(wrapper.find('.strip').text()).toContain('Across 0 pens');
  });
});

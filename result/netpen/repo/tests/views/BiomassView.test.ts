import { setActivePinia } from 'pinia';
import { afterEach, describe, expect, it } from 'vitest';

import { clearStoredPreferences } from '@/app/stores/preferences';
import type { PenView } from '@/data/projections/pen';
import type { SiteView } from '@/data/projections/site';
import type { Site } from '@/domain/site/types';
import BiomassView from '@/views/BiomassView.vue';

import { mountView, settle } from '../support/mount';
import { penView, TEST_NOW } from '../support/penView';

const SITE = { regime: 'norway', maxBiomassT: 2_500 } as Site;

const PENS = [
  penView({ number: 1, count: 40_000, meanWeightG: 5_400 }),
  penView({ number: 2, count: 50_000, meanWeightG: 4_600 }),
];

interface Overrides {
  readonly weeksToBreach?: number | null;
  readonly harvestRequiredT?: number[];
  readonly standingT?: number;
  readonly projection?: { weeksAhead: number; biomassT: number }[];
  readonly pens?: PenView[];
}

function siteViewOf(overrides: Overrides = {}): SiteView {
  const standingT = overrides.standingT ?? 1_950;
  return {
    at: TEST_NOW,
    pens: overrides.pens ?? PENS,
    stocked: overrides.pens ?? PENS,
    licence: {
      standingT,
      limitT: 2_500,
      headroomT: 2_500 - standingT,
      utilisation: standingT / 2_500,
      overLimit: standingT > 2_500,
    },
    projection: overrides.projection ?? [
      { weeksAhead: 0, at: TEST_NOW, biomassT: standingT, overLimit: false },
      { weeksAhead: 4, at: TEST_NOW, biomassT: 2_280, overLimit: false },
      { weeksAhead: 8, at: TEST_NOW, biomassT: 2_700, overLimit: true },
    ],
    weeksToBreach: overrides.weeksToBreach === undefined ? 2 : overrides.weeksToBreach,
    harvestRequiredT: overrides.harvestRequiredT ?? [0, 0, 200, 340],
    siteLiceAverage: 0.14,
    alerts: [],
    standingCount: 90_000,
  } as unknown as SiteView;
}

async function page(overrides: Overrides = {}) {
  const { wrapper } = await mountView(BiomassView, {
    path: '/biomass',
    api: {
      getSite: () => Promise.resolve(SITE),
      getSiteView: () => Promise.resolve(siteViewOf(overrides)),
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
  it('puts standing biomass against the consented figure', async () => {
    const wrapper = await page();
    const strip = wrapper.find('.strip').text();
    expect(strip).toContain('1950.0');
    expect(strip).toContain('2500 t consented');
  });

  it('turns the utilisation amber as the site nears the ceiling', async () => {
    const wrapper = await page({ standingT: 2_300 });
    expect(wrapper.findAll('.strip > *')[1]?.classes()).toContain('caution');
  });

  it('reads the headroom as a warning once it goes negative', async () => {
    const wrapper = await page({ standingT: 2_700 });
    const headroom = wrapper.findAll('.strip > *')[2];
    expect(headroom?.classes()).toContain('bad');
    expect(headroom?.text()).toContain('over its licence');
  });

  it('says the licence is not reached within the projection when it is not', async () => {
    const wrapper = await page({ weeksToBreach: null });
    expect(wrapper.find('.strip').text()).toContain('Not within the projection');
  });

  it('counts the weeks to the ceiling when there are some', async () => {
    const wrapper = await page({ weeksToBreach: 6 });
    expect(wrapper.find('.strip').text()).toContain('In 6 weeks if nothing comes off');
  });

  it('reports the peak the projection reaches', async () => {
    const wrapper = await page();
    expect(wrapper.findAll('.strip > *').at(-1)?.text()).toContain('2700');
  });
});

describe('the projection', () => {
  it('says out loud that it assumes no harvest', async () => {
    const wrapper = await page();
    expect(wrapper.text()).toContain('Assumes no harvest');
  });

  it('draws the licence at the consented figure, not at the peak', async () => {
    const wrapper = await page();
    expect(wrapper.find('.limitLabel').text()).toBe('Licence 2500 t');
  });

  it('shades the overshoot when the projection goes over', async () => {
    const wrapper = await page();
    expect(wrapper.find('path.overshoot').exists()).toBe(true);
  });
});

describe('the harvest plan', () => {
  it('asks for the tonnage due at the week the site first goes over', async () => {
    const wrapper = await page({ weeksToBreach: 2, harvestRequiredT: [0, 0, 200, 340] });
    expect(wrapper.find('.lead').text()).toContain('200 t has to come off');
  });

  it('asks for nothing when the projection stays inside', async () => {
    const wrapper = await page({ weeksToBreach: null });
    expect(wrapper.find('.lead').text()).toContain('Nothing has to come off');
  });
});

import { setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearStoredPreferences } from '@/app/stores/preferences';
import type { PenView } from '@/data/projections/pen';
import type { SiteView } from '@/data/projections/site';
import type { Site } from '@/domain/site/types';
import LiceRegisterView from '@/views/LiceRegisterView.vue';

import { mountView, settle } from '../support/mount';
import { emptyPen, penView, TEST_NOW } from '../support/penView';

const SITE = { regime: 'norway', name: 'Eilean Dubh' } as Site;

function siteViewOf(pens: PenView[], siteLiceAverage: number | null = 0.21): SiteView {
  return { at: TEST_NOW, pens, siteLiceAverage } as unknown as SiteView;
}

const PENS = [
  penView({ number: 1, adultFemale: 0.62, count: 50_000 }),
  penView({ number: 2, adultFemale: 0.08, count: 60_000 }),
  emptyPen(3),
];

async function register(pens: PenView[] = PENS, average: number | null = 0.21) {
  const { wrapper } = await mountView(LiceRegisterView, {
    path: '/lice',
    api: {
      getSite: () => Promise.resolve(SITE),
      getSiteView: () => Promise.resolve(siteViewOf(pens, average)),
      listPeople: () => Promise.resolve([]),
    },
  });
  await settle(wrapper, 8);
  return wrapper;
}

afterEach(() => {
  clearStoredPreferences();
  setActivePinia(undefined);
  vi.unstubAllGlobals();
});

describe('the heading', () => {
  it('says what the limit is this week rather than making the reader look it up', async () => {
    const wrapper = await register();
    expect(wrapper.find('.note').text()).toContain('0.50 adult female per fish');
  });
});

describe('the summary strip', () => {
  it('shows the weighted site figure, not the mean of the pen figures', async () => {
    const wrapper = await register(PENS, 0.32);
    expect(wrapper.find('.strip').text()).toContain('0.32');
    expect(wrapper.find('.strip').text()).toContain('Weighted by the fish in each pen');
  });

  it('counts the pens over the limit that applies this week', async () => {
    const wrapper = await register();
    const tile = wrapper.findAll('.strip > *')[1];
    expect(tile?.text()).toContain('1');
    expect(tile?.classes()).toContain('bad');
  });

  it('names the pens that owe a treatment', async () => {
    const wrapper = await register([
      penView({ number: 4, obligation: true }),
      penView({ number: 6, obligation: true }),
    ]);
    expect(wrapper.find('.strip').text()).toContain('Pens 4, 6');
  });

  it('says nothing is outstanding when nothing is', async () => {
    const wrapper = await register([penView({ number: 1 })]);
    expect(wrapper.find('.strip').text()).toContain('Nothing outstanding');
  });

  it('reports an em dash rather than a zero when nothing has been counted', async () => {
    const wrapper = await register([emptyPen(1)], null);
    expect(wrapper.findAll('.strip > *')[0]?.text()).toContain('—');
  });
});

describe('the table', () => {
  it('carries a row for every pen, empty ones included', async () => {
    expect((await register()).findAll('tbody tr')).toHaveLength(3);
  });
});

describe('filing a count', () => {
  it('keeps the form shut until a pen is chosen', async () => {
    expect((await register()).find('dialog').exists()).toBe(false);
  });

  it('opens the form against the pen whose button was pressed', async () => {
    const wrapper = await register();
    await wrapper.findAll('tbody button')[1]!.trigger('click');
    await settle(wrapper, 4);
    expect(wrapper.find('dialog .subtitle').text()).toBe('Pen 2');
  });

  it('shuts the form again when it asks to close', async () => {
    vi.stubGlobal('confirm', () => true);
    const wrapper = await register();
    await wrapper.findAll('tbody button')[0]!.trigger('click');
    await settle(wrapper, 4);
    await wrapper.find('dialog button.close').trigger('click');
    await settle(wrapper, 4);
    expect(wrapper.find('dialog').exists()).toBe(false);
  });
});

describe('exporting', () => {
  function stubObjectUrls() {
    const created = vi.fn<(blob: Blob) => string>(() => 'blob:x');
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }),
    );
    return created;
  }

  /** jsdom blobs have no text(), so the file comes back through a reader. */
  function readBlob(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('could not read the exported file'));
      reader.readAsText(blob);
    });
  }

  async function exported(wrapper: Awaited<ReturnType<typeof register>>): Promise<string> {
    const created = stubObjectUrls();
    await wrapper.find('button.export').trigger('click');
    return readBlob(created.mock.calls[0]![0]);
  }

  it('writes a row per pen, uncounted ones included', async () => {
    const text = await exported(await register());
    const lines = text.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(4);
  });

  it('carries the limit each count was judged against, not the one in force today', async () => {
    const text = await exported(
      await register([penView({ number: 1, countedAt: Date.UTC(2025, 3, 30) })]),
    );
    expect(text).toContain('0.20');
  });

  it('names who counted and how many fish they looked at', async () => {
    const text = await exported(await register([penView({ number: 1, countedBy: 'R. Lamont' })]));
    expect(text).toContain('R. Lamont');
    expect(text).toContain('Pen,Counted at,Counted by,Fish examined');
  });

  it('leaves an uncounted pen blank rather than writing zeroes into the register', async () => {
    const text = await exported(await register([emptyPen(4)]));
    const row = (text.split('\r\n')[1] ?? '').replace(/^\ufeff/, '');
    // Pen number, then empty cells all the way across: no dashes, no zeroes
    // and no status, because nothing was counted.
    expect(row).toBe('4,,,0,,,,,,,');
  });

  it('will not offer an export of nothing', async () => {
    const wrapper = await register([]);
    expect(wrapper.find('button.export').attributes('disabled')).toBeDefined();
  });
});

describe('the trend', () => {
  it('stays off the screen until there is more than one week to draw', async () => {
    const wrapper = await register([
      penView({ number: 1, weekly: [{ week: 12, adultFemale: 0.1 }] }),
    ]);
    expect(wrapper.find('rect.bar').exists()).toBe(false);
  });

  it('weights each week by the fish in the pens counted that week', async () => {
    const wrapper = await register([
      penView({
        number: 1,
        count: 30_000,
        weekly: [
          { week: 12, adultFemale: 0.2 },
          { week: 13, adultFemale: 0.4 },
        ],
      }),
      penView({
        number: 2,
        count: 10_000,
        weekly: [
          { week: 12, adultFemale: 0.6 },
          { week: 13, adultFemale: 0.8 },
        ],
      }),
    ]);
    const titles = wrapper.findAll('rect.bar title').map((node) => node.text());
    // Thirty thousand fish at 0.2 and ten thousand at 0.6 is 0.30, not 0.40.
    expect(titles[0]).toContain('0.30');
    expect(titles[1]).toContain('0.50');
  });
});

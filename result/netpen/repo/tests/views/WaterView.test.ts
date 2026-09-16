import { setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearStoredPreferences } from '@/app/stores/preferences';
import type { PenBoardRow } from '@/data/api';
import type { OxygenReading } from '@/data/fixtures/environment';
import type { PenView } from '@/data/projections/pen';
import type { TemperatureSample } from '@/domain/time/degreeDays';
import WaterView from '@/views/WaterView.vue';

import { mountView, settle } from '../support/mount';
import { emptyPen, penView, TEST_NOW } from '../support/penView';

const HOUR = 3_600_000;
const DAY = 86_400_000;

function row(view: PenView): PenBoardRow {
  return { view, alerts: [] };
}

function oxygenAt(depthM: number, hoursAgo: number, saturationPercent: number): OxygenReading {
  return {
    penId: 'pen-1',
    at: TEST_NOW - hoursAgo * HOUR,
    depthM,
    temperatureC: 12 - depthM * 0.2,
    salinityPsu: 33.6,
    oxygenMgL: 9,
    saturationPercent,
  };
}

const COLUMN = [
  oxygenAt(1, 6, 98),
  oxygenAt(5, 6, 91),
  oxygenAt(10, 6, 82),
  oxygenAt(1, 1, 96),
  oxygenAt(5, 1, 89),
  oxygenAt(10, 1, 80),
];

function temperatures(meanC: number): TemperatureSample[] {
  return [
    { at: TEST_NOW - 30 * DAY, meanC: meanC - 1 },
    { at: TEST_NOW, meanC },
  ];
}

async function page(
  pens: PenView[] = [penView({ number: 1 }), penView({ number: 2 })],
  readings: OxygenReading[] = COLUMN,
) {
  const listOxygen = vi.fn<(penId: string, from: number, to: number) => Promise<OxygenReading[]>>(
    () => Promise.resolve(readings),
  );
  const { wrapper } = await mountView(WaterView, {
    path: '/water',
    api: {
      listPenBoard: () => Promise.resolve(pens.map(row)),
      listOxygen,
      listTemperatures: (depthM: number) => Promise.resolve(temperatures(depthM === 5 ? 9.4 : 8.1)),
    },
  });
  await settle(wrapper, 10);
  return { wrapper, listOxygen };
}

afterEach(() => {
  clearStoredPreferences();
  setActivePinia(undefined);
});

describe('the pen picker', () => {
  it('offers only pens with fish in them', async () => {
    const { wrapper } = await page([penView({ number: 1 }), emptyPen(2), penView({ number: 3 })]);
    const options = wrapper.findAll('select option').map((option) => option.text());
    expect(options).toContain('Pen 1');
    expect(options).toContain('Pen 3');
    expect(options).not.toContain('Pen 2');
  });

  it('lands on a pen rather than an empty picker', async () => {
    const { wrapper } = await page();
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('pen-1');
  });

  it('fetches the probe record for the pen that was chosen', async () => {
    const { wrapper, listOxygen } = await page();
    await wrapper.find('select').setValue('pen-2');
    await settle(wrapper, 6);
    expect(listOxygen).toHaveBeenCalledWith('pen-2', expect.any(Number), expect.any(Number));
  });

  it('says so plainly when every pen is empty', async () => {
    const { wrapper } = await page([emptyPen(1), emptyPen(2)]);
    expect(wrapper.text()).toContain('Nothing in the water');
  });
});

describe('the window', () => {
  it('fetches a wider window when a longer one is chosen', async () => {
    const { wrapper, listOxygen } = await page();
    const before = listOxygen.mock.calls.at(-1)!;

    await wrapper.findAll('select')[1]!.setValue('7');
    await settle(wrapper, 6);

    const after = listOxygen.mock.calls.at(-1)!;
    expect(after[2]! - after[1]!).toBeGreaterThan(before[2]! - before[1]!);
  });
});

describe('the water column', () => {
  it('builds the profile from the latest reading at each depth', async () => {
    const { wrapper } = await page();
    const titles = wrapper.findAll('circle title').map((node) => node.text());
    expect(titles).toHaveLength(3);
    expect(titles[0]).toContain('96 % saturation');
  });

  it('draws the net where the fish actually stop', async () => {
    const { wrapper } = await page();
    expect(wrapper.find('line.net').exists()).toBe(true);
  });

  it('says one depth is not a profile rather than drawing a line through one point', async () => {
    const { wrapper } = await page([penView({ number: 1 })], [oxygenAt(5, 1, 90)]);
    expect(wrapper.text()).toContain('not a profile');
  });
});

describe('sea temperature', () => {
  it('shows the shallow figure in the subtitle, since growth is driven by it', async () => {
    const { wrapper } = await page();
    expect(wrapper.text()).toContain('9.4 C at 5 m');
  });

  it('draws both depths, so the stratification is visible', async () => {
    const { wrapper } = await page();
    const labels = wrapper.text();
    expect(labels).toContain('5 m');
    expect(labels).toContain('15 m');
  });
});

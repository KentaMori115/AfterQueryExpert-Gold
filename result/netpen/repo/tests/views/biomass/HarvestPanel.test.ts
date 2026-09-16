import { describe, expect, it } from 'vitest';

import type { PenView } from '@/data/projections/pen';
import HarvestPanel from '@/views/biomass/HarvestPanel.vue';

import { mountView } from '../../support/mount';
import { emptyPen, penView } from '../../support/penView';

async function panel(pens: PenView[], requiredT = 0, weeksToBreach: number | null = null) {
  const { wrapper } = await mountView(HarvestPanel, {
    props: { pens, requiredT, weeksToBreach },
  });
  return wrapper;
}

const PENS = [
  penView({ number: 1, count: 40_000, meanWeightG: 5_400 }),
  penView({ number: 2, count: 55_000, meanWeightG: 3_100 }),
  penView({ number: 3, count: 50_000, meanWeightG: 4_600 }),
];

function penNumbers(wrapper: Awaited<ReturnType<typeof panel>>): string[] {
  return wrapper.findAll('tbody tr td:first-child').map((cell) => cell.text());
}

describe('when nothing has to come off', () => {
  it('says so rather than proposing a harvest', async () => {
    const wrapper = await panel(PENS);
    expect(wrapper.find('.lead').text()).toContain('Nothing has to come off');
    expect(wrapper.findAll('.badge').filter((b) => b.text() === 'Take')).toHaveLength(0);
  });

  it('says the site is inside the licence for as far as the projection runs', async () => {
    const wrapper = await panel(PENS);
    expect(wrapper.find('.subtitle').text()).toContain('Inside the licence');
  });
});

describe('the order', () => {
  it('takes the heaviest fish first, not the biggest pen', async () => {
    expect(penNumbers(await panel(PENS))).toEqual(['Pen 1', 'Pen 3', 'Pen 2']);
  });

  it('drops a pen inside a withdrawal to the bottom, however heavy it is', async () => {
    const wrapper = await panel([
      penView({ number: 1, meanWeightG: 6_000, withdrawalRemaining: 90, blocking: true }),
      penView({ number: 2, meanWeightG: 4_000 }),
    ]);
    expect(penNumbers(wrapper)).toEqual(['Pen 2', 'Pen 1']);
  });

  it('leaves empty pens out of the plan entirely', async () => {
    const wrapper = await panel([penView({ number: 1 }), emptyPen(2)]);
    expect(wrapper.findAll('tbody tr')).toHaveLength(1);
  });
});

describe('choosing pens', () => {
  it('takes pens in order until the tonnage is covered, and stops', async () => {
    // Pen 1 is 216 t, which covers 200 t on its own.
    const wrapper = await panel(PENS, 200);
    const takes = wrapper.findAll('.badge').filter((badge) => badge.text() === 'Take');
    expect(takes).toHaveLength(1);
  });

  it('takes a second pen when the first does not cover it', async () => {
    const wrapper = await panel(PENS, 400);
    const takes = wrapper.findAll('.badge').filter((badge) => badge.text() === 'Take');
    expect(takes).toHaveLength(2);
  });

  it('never proposes a pen that cannot legally be harvested', async () => {
    const wrapper = await panel(
      [penView({ number: 1, meanWeightG: 6_000, withdrawalRemaining: 90, blocking: true })],
      300,
    );
    expect(wrapper.findAll('.badge').filter((b) => b.text() === 'Take')).toHaveLength(0);
    expect(wrapper.find('.badge').text()).toBe('Blocked');
  });

  it('says plainly when the site cannot cover the licence with what it can harvest', async () => {
    const wrapper = await panel(PENS, 5_000);
    expect(wrapper.find('.short').text()).toContain('short of what the licence needs');
    expect(wrapper.find('.panel').classes()).toContain('alarm');
  });
});

describe('the tonnages', () => {
  it('gives live and gutted separately, since the well boat is paid on one', async () => {
    const wrapper = await panel([penView({ number: 1, count: 40_000, meanWeightG: 5_000 })]);
    const cells = wrapper.findAll('tbody td').map((cell) => cell.text());
    expect(cells).toContain('200.0 t');
    expect(cells.some((cell) => cell.endsWith(' t') && cell !== '200.0 t')).toBe(true);
  });

  it('names the band most of the fish land in', async () => {
    const wrapper = await panel([penView({ number: 1, meanWeightG: 4_600 })]);
    expect(wrapper.find('tbody').text()).toMatch(/\d-\d kg/);
  });

  it('downgrades a pen that has been carrying wounds', async () => {
    const clean = await panel([penView({ number: 1 })]);
    const wounded = await panel([penView({ number: 1, mortalityLevel: 'incident' })]);
    const superiorOf = (wrapper: Awaited<ReturnType<typeof panel>>) =>
      Number(
        wrapper
          .findAll('tbody td')
          .at(-2)
          ?.text()
          .replace(/[^\d.]/g, ''),
      );
    expect(superiorOf(wounded)).toBeLessThan(superiorOf(clean));
  });
});

describe('the small print', () => {
  it('states the spread and condition the tonnage rests on', async () => {
    const wrapper = await panel(PENS);
    expect(wrapper.find('.assumption').text()).toContain('coefficient of variation');
    expect(wrapper.find('.assumption').text()).toContain('1.16');
  });

  it('says when a blocked pen clears, so the plan has a date to work to', async () => {
    const wrapper = await panel([penView({ number: 5, withdrawalRemaining: 62, blocking: true })]);
    expect(wrapper.find('.blockedNote').text()).toContain('Pen 5 clears its withdrawal in 62');
  });

  it('counts down to the licence when a breach is projected', async () => {
    const wrapper = await panel(PENS, 120, 9);
    expect(wrapper.find('.subtitle').text()).toBe('Licence reached in 9 weeks');
  });
});

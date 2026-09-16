import { describe, expect, it } from 'vitest';

import PenCard from '@/views/pens/PenCard.vue';

import { mountView } from '../../support/mount';
import { emptyPen, penView } from '../../support/penView';

async function card(view = penView()) {
  const { wrapper } = await mountView(PenCard, { props: { view } });
  return wrapper;
}

describe('a stocked pen', () => {
  it('names the pen and counts the fish in it', async () => {
    const wrapper = await card(penView({ number: 4, count: 61_500 }));
    expect(wrapper.find('h3').text()).toContain('Pen 4');
    expect(wrapper.find('.status').text()).toBe('61,500 fish');
  });

  it('links to the pen page', async () => {
    const wrapper = await card(penView({ number: 4 }));
    expect(wrapper.find('a').attributes('href')).toBe('/pens/pen-4');
  });

  it('writes the lice figure to two places, as the register does', async () => {
    const wrapper = await card(penView({ adultFemale: 0.4 }));
    expect(wrapper.text()).toContain('0.40 AF');
  });

  it('says nobody has counted rather than showing a zero', async () => {
    const wrapper = await card(penView({ adultFemale: null }));
    expect(wrapper.text()).toContain('Not counted');
    expect(wrapper.text()).not.toContain('0.00 AF');
  });

  it('shows biomass in tonnes and mean weight in its natural unit', async () => {
    const wrapper = await card(penView({ count: 50_000, meanWeightG: 4_000 }));
    const figures = wrapper.find('.figures').text();
    expect(figures).toContain('200.0');
    expect(figures).toContain('4.0 kg');
  });
});

describe('the badge strip', () => {
  it('makes exactly one badge solid, and only when something is wrong', async () => {
    const healthy = await card();
    expect(healthy.findAll('.badge.solid')).toHaveLength(0);

    const sick = await card(penView({ liceStatus: 'over-limit', oxygenBand: 'low' }));
    expect(sick.findAll('.badge.solid')).toHaveLength(1);
  });

  it('gives the solid badge to lice when lice and oxygen are both bad', async () => {
    const wrapper = await card(penView({ liceStatus: 'over-limit', oxygenBand: 'critical' }));
    expect(wrapper.find('.badge.solid').text()).toContain('AF');
  });

  it('leaves mortality off the strip while it is normal', async () => {
    expect((await card()).text()).not.toContain('/d');
    const sick = await card(penView({ mortalityLevel: 'incident' }));
    expect(sick.text()).toContain('/d');
  });
});

describe('the density bar', () => {
  it('fills in proportion to the limit', async () => {
    const wrapper = await card(penView({ densityKgM3: 12.5 }));
    expect(wrapper.find('.level').attributes('style')).toContain('width: 50%');
  });

  it('does not run past the end of its track when the pen is over', async () => {
    const wrapper = await card(penView({ densityKgM3: 31, densityStatus: 'over-limit' }));
    expect(wrapper.find('.level').attributes('style')).toContain('width: 100%');
    expect(wrapper.find('.level').classes()).toContain('bad');
  });
});

describe('the footer line', () => {
  it('shows the withdrawal while one is running', async () => {
    const wrapper = await card(penView({ withdrawalRemaining: 88 }));
    expect(wrapper.find('.withdrawal').text()).toContain('88 degree days');
  });

  it('prefers the withdrawal over the treatment obligation, since it blocks it', async () => {
    const wrapper = await card(penView({ withdrawalRemaining: 88, obligation: true }));
    expect(wrapper.find('.withdrawal').exists()).toBe(true);
    expect(wrapper.find('.obligation').exists()).toBe(false);
  });

  it('shows the obligation once nothing is blocking it', async () => {
    const wrapper = await card(penView({ obligation: true }));
    expect(wrapper.find('.obligation').text()).toContain('Over limit');
  });
});

describe('an empty pen', () => {
  it('says so instead of showing zeroes', async () => {
    const wrapper = await card(emptyPen(2));
    expect(wrapper.find('.empty').text()).toContain('Nothing standing');
    expect(wrapper.find('.figures').exists()).toBe(false);
    expect(wrapper.findAll('.badge')).toHaveLength(0);
  });

  it('still links through, because the net and the log are still there', async () => {
    const wrapper = await card(emptyPen(2));
    expect(wrapper.find('a').attributes('href')).toBe('/pens/pen-2');
  });
});

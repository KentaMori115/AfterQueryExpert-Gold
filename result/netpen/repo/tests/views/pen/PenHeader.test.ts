import { describe, expect, it } from 'vitest';

import PenHeader from '@/views/pen/PenHeader.vue';

import { mountView } from '../../support/mount';
import { emptyPen, penView, TEST_NOW } from '../../support/penView';

async function header(view = penView(), openAlerts = 0) {
  const { wrapper } = await mountView(PenHeader, {
    props: { view, now: TEST_NOW, openAlerts },
  });
  return wrapper;
}

describe('identity', () => {
  it('names the pen and the generation in it', async () => {
    const wrapper = await header(penView({ number: 6 }));
    expect(wrapper.find('h2').text()).toContain('Pen 6');
    expect(wrapper.find('.line').text()).toContain('S24 Aquagen');
  });

  it('gives the net dimensions, which decide the volume', async () => {
    const text = (await header()).find('.line').text();
    expect(text).toContain('157 m circumference');
    expect(text).toContain('22 m net');
  });

  it('writes the cycle age the way it is spoken', async () => {
    const wrapper = await header(penView({ stockedAt: TEST_NOW - 330 * 86_400_000 }));
    expect(wrapper.find('.facts').text()).toMatch(/10 mo, week 4[67]/);
  });

  it('counts the fish rather than describing the pen when it is stocked', async () => {
    const wrapper = await header(penView({ count: 58_400 }));
    expect(wrapper.find('.facts').text()).toContain('58,400 fish');
  });
});

describe('states', () => {
  it('repeats what the board card said, so the click does not feel like a jump', async () => {
    const wrapper = await header(penView({ liceStatus: 'over-limit' }));
    const lice = wrapper.findAll('.badge').find((badge) => badge.text() === 'Lice');
    expect(lice?.classes()).toContain('bad');
  });

  it('leaves out a state nobody has measured', async () => {
    const wrapper = await header(penView({ mortalityLevel: 'unknown' }));
    const labels = wrapper.findAll('.badge').map((badge) => badge.text());
    expect(labels).not.toContain('Mortality');
    expect(labels).toContain('Lice');
  });

  it('spells the state out in the title, since the badge only carries a word', async () => {
    const wrapper = await header(penView({ oxygenBand: 'low' }));
    const oxygen = wrapper.findAll('.badge').find((badge) => badge.text() === 'Oxygen');
    expect(oxygen?.attributes('title')).toBe('Oxygen: low');
  });
});

describe('an empty pen', () => {
  it('describes the pen rather than showing a count of nothing', async () => {
    const wrapper = await header(emptyPen(3));
    expect(wrapper.find('.facts').text()).toContain('Stocked');
    expect(wrapper.findAll('.badge')).toHaveLength(0);
  });
});

describe('alerts', () => {
  it('stays quiet when there are none', async () => {
    expect((await header()).text()).not.toContain('Open alerts');
  });

  it('counts them when there are', async () => {
    const wrapper = await header(penView(), 3);
    expect(wrapper.find('.alerts').text()).toContain('3');
  });
});

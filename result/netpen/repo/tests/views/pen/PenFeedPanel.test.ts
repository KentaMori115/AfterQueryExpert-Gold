import { describe, expect, it } from 'vitest';

import type { Appetite } from '@/domain/feed/plan';
import PenFeedPanel from '@/views/pen/PenFeedPanel.vue';

import { mountView } from '../../support/mount';
import { emptyPen, penView } from '../../support/penView';

async function feed(view = penView(), appetite: Appetite = 'normal') {
  const { wrapper } = await mountView(PenFeedPanel, { props: { view, appetite } });
  return wrapper;
}

describe('the ration', () => {
  it('leads with one figure in kilogrammes', async () => {
    const wrapper = await feed();
    expect(wrapper.find('.value').text()).toMatch(/^\d+$/);
    expect(wrapper.find('.unit').text()).toBe('kg');
  });

  it('says it is feeding to table when nothing is holding it back', async () => {
    const wrapper = await feed(penView({ saturationPercent: 96, temperatureC: 11 }));
    expect(wrapper.find('.badge').text()).toBe('Feeding to table');
    expect(wrapper.find('.against').text()).toContain('% of body weight');
  });

  it('gives the rate as a percentage of body weight, which is how it is checked', async () => {
    const wrapper = await feed(penView({ saturationPercent: 96, temperatureC: 11 }));
    expect(wrapper.find('.against').text()).toMatch(/\d\.\d\d %/);
  });
});

describe('when something is holding the ration back', () => {
  it('names the constraint rather than only cutting the number', async () => {
    const wrapper = await feed(penView({ saturationPercent: 68 }));
    expect(wrapper.find('.badge').text()).toBe('Held back by oxygen');
  });

  it('shows what the table would have said, and how much of it is left', async () => {
    const wrapper = await feed(penView({ saturationPercent: 68 }));
    const against = wrapper.find('.against').text();
    expect(against).toContain('Table says');
    expect(against).toMatch(/\d+ % of it/);
  });

  it('goes amber, since the crew have to know before they load the barge', async () => {
    const held = await feed(penView({ saturationPercent: 68 }));
    expect(held.find('.panel').classes()).toContain('caution');

    const free = await feed(penView({ saturationPercent: 96, temperatureC: 11 }));
    expect(free.find('.panel').classes()).not.toContain('caution');
  });

  it('holds the pen off feed entirely the day before a crowd', async () => {
    const wrapper = await feed(penView({ daysToHandling: 1 }));
    expect(wrapper.find('.value').text()).toBe('0');
    expect(wrapper.find('.badge').text()).toBe('Off feed before handling');
  });
});

describe('the other constraints', () => {
  it('lists them with what each would allow, tightest first', async () => {
    const wrapper = await feed(penView({ saturationPercent: 68 }));
    const allows = wrapper.findAll('.allows').map((node) => Number(node.text().replace(/\D/g, '')));
    expect(allows.length).toBeGreaterThan(2);
    expect(allows).toEqual([...allows].sort((a, b) => a - b));
  });

  it('leaves the binding one out of the list, since it is already the headline', async () => {
    const wrapper = await feed(penView({ saturationPercent: 68 }));
    const names = wrapper.findAll('.name').map((node) => node.text());
    expect(names).not.toContain('Held back by oxygen');
  });
});

describe('the detail line', () => {
  it('gives the pellet size for the fish in the pen', async () => {
    const wrapper = await feed(penView({ meanWeightG: 3_200 }));
    expect(wrapper.find('.detail').text()).toContain('mm');
  });

  it('carries the water the plan was made against', async () => {
    const wrapper = await feed(penView({ temperatureC: 9.4, saturationPercent: 88 }));
    expect(wrapper.find('.detail').text()).toContain('9.4 C');
    expect(wrapper.find('.detail').text()).toContain('88 %');
  });
});

describe('appetite', () => {
  it('shows what the crew last observed', async () => {
    const wrapper = await feed(penView(), 'slow');
    const checked = wrapper.find('input:checked');
    expect((checked.element as HTMLInputElement).value).toBe('slow');
  });

  it('asks the parent to change it rather than deciding on its own', async () => {
    const wrapper = await feed(penView(), 'normal');
    const off = wrapper.findAll('input').find((input) => input.element.value === 'off');
    await off?.setValue(true);
    expect(wrapper.emitted('update:appetite')?.[0]).toEqual(['off']);
  });
});

describe('an empty pen', () => {
  it('says there is nothing to feed instead of planning a ration of zero', async () => {
    const wrapper = await feed(emptyPen(3));
    expect(wrapper.find('.none').text()).toContain('Nothing to feed');
    expect(wrapper.find('.value').exists()).toBe(false);
  });
});

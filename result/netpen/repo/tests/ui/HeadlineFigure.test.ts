import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import HeadlineFigure from '@/ui/HeadlineFigure.vue';

function figure(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  return mount(HeadlineFigure, { props: { value: '0.42', ...props }, slots });
}

describe('the figure', () => {
  it('shows the value exactly as it was handed over', () => {
    expect(figure({ value: '0.40' }).find('.value').text()).toBe('0.40');
  });

  it('does not round or reformat what it was given', () => {
    expect(figure({ value: '1,240' }).find('.value').text()).toBe('1,240');
  });

  it('keeps the unit outside the figure, so a row of them lines up', () => {
    const wrapper = figure({ unit: 'kg' });
    expect(wrapper.find('.unit').text()).toBe('kg');
    expect(wrapper.find('.value').text()).toBe('0.42');
  });

  it('leaves the unit out when there is none', () => {
    expect(figure().find('.unit').exists()).toBe(false);
  });
});

describe('the label', () => {
  it('sits under the figure when it is plain text', () => {
    expect(figure({ label: 'adult female per fish' }).find('.label').text()).toBe(
      'adult female per fish',
    );
  });

  it('is left out entirely when there is none', () => {
    expect(figure().find('.label').exists()).toBe(false);
  });

  it('takes markup where the label needs a link or a time in it', () => {
    const wrapper = figure({}, { label: '<span class="label">low, at <b>15:00</b></span>' });
    expect(wrapper.find('.label b').text()).toBe('15:00');
  });
});

describe('a figure that is a low rather than a reading', () => {
  it('is marked so it does not read as the current value', () => {
    expect(figure({ muted: true }).find('.value').classes()).toContain('muted');
    expect(figure().find('.value').classes()).not.toContain('muted');
  });
});

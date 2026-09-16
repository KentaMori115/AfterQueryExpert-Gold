import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { MISSING } from '@/ui/format';
import StatTile from '@/ui/StatTile.vue';

describe('rendering', () => {
  it('shows the label, value and unit', () => {
    const wrapper = mount(StatTile, {
      props: { label: 'Adult female', value: '0.42', unit: 'per fish' },
    });
    expect(wrapper.find('.label').text()).toContain('Adult female');
    expect(wrapper.find('.value').text()).toBe('0.42');
    expect(wrapper.find('.unit').text()).toBe('per fish');
  });

  it('renders the value exactly as it was given', () => {
    const wrapper = mount(StatTile, { props: { label: 'Biomass', value: '1,836.0' } });
    expect(wrapper.find('.value').text()).toBe('1,836.0');
  });

  it('shows a detail line when supplied and omits it otherwise', () => {
    const withDetail = mount(StatTile, {
      props: { label: 'Peak', value: '0.62', detail: 'limit 0.50' },
    });
    expect(withDetail.find('.detail').text()).toBe('limit 0.50');
    expect(
      mount(StatTile, { props: { label: 'Peak', value: '0.62' } })
        .find('.detail')
        .exists(),
    ).toBe(false);
  });

  it('renders a badge beside the label', () => {
    const wrapper = mount(StatTile, {
      props: { label: 'Lice', value: '0.42' },
      slots: { badge: '<span class="probe">over</span>' },
    });
    expect(wrapper.find('.probe').exists()).toBe(true);
  });
});

describe('missing values', () => {
  it('drops the unit when the value is missing', () => {
    const wrapper = mount(StatTile, {
      props: { label: 'Peak', value: MISSING, unit: 'per fish' },
    });
    expect(wrapper.find('.value').text()).toBe(MISSING);
    expect(wrapper.find('.unit').exists()).toBe(false);
  });

  it('mutes a missing value whatever tone was asked for', () => {
    const wrapper = mount(StatTile, { props: { label: 'Peak', value: MISSING, tone: 'bad' } });
    expect(wrapper.classes()).toContain('muted');
    expect(wrapper.classes()).not.toContain('bad');
  });
});

describe('tones and density', () => {
  it('carries the tone as a class', () => {
    for (const tone of ['good', 'caution', 'bad', 'info'] as const) {
      expect(mount(StatTile, { props: { label: 'x', value: '1', tone } }).classes()).toContain(
        tone,
      );
    }
  });

  it('renders a compact tile differently', () => {
    expect(
      mount(StatTile, { props: { label: 'x', value: '1', compact: true } }).classes(),
    ).toContain('compact');
    expect(mount(StatTile, { props: { label: 'x', value: '1' } }).classes()).not.toContain(
      'compact',
    );
  });
});

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { Component } from 'vue';

import type { Point } from '@/ui/charts/path';
import TraceChart from '@/ui/charts/TraceChart.vue';

const Chart = TraceChart as unknown as Component;

function ramp(from: number, to: number, count: number): Point[] {
  return Array.from({ length: count }, (_unused, index) => ({
    x: index,
    y: from + ((to - from) * index) / (count - 1),
  }));
}

function chart(props: Record<string, unknown> = {}) {
  return mount(Chart, {
    props: {
      caption: 'Sea temperature by week',
      series: [{ key: 'temperature', label: 'At 5 m', points: ramp(7, 15, 40) }],
      ...props,
    },
  });
}

describe('rendering', () => {
  it('draws into a viewBox rather than measuring anything', () => {
    const svg = chart().find('svg');
    expect(svg.attributes('viewBox')).toBe('0 0 720 220');
    expect(svg.attributes('preserveAspectRatio')).toBe('none');
  });

  it('labels the figure for assistive technology', () => {
    const wrapper = chart();
    expect(wrapper.find('figcaption').text()).toBe('Sea temperature by week');
    expect(wrapper.find('svg').attributes('aria-label')).toBe('Sea temperature by week');
    expect(wrapper.find('svg').attributes('role')).toBe('img');
  });

  it('draws a path per series', () => {
    const wrapper = chart({
      series: [
        { key: 'temperature', label: 'At 5 m', points: ramp(7, 15, 20) },
        { key: 'temperatureDeep', label: 'At 15 m', points: ramp(6, 12, 20) },
      ],
    });
    expect(wrapper.findAll('.trace')).toHaveLength(2);
  });

  it('gives each series a legend entry', () => {
    const wrapper = chart({
      series: [
        { key: 'temperature', label: 'At 5 m', points: ramp(7, 15, 20) },
        { key: 'temperatureDeep', label: 'At 15 m', points: ramp(6, 12, 20) },
      ],
    });
    expect(wrapper.findAll('.legend .entry')).toHaveLength(2);
    expect(wrapper.find('.legend').text()).toContain('At 15 m');
  });

  it('honours the height it was given', () => {
    expect(chart({ height: 320 }).find('svg').attributes('viewBox')).toBe('0 0 720 320');
  });
});

describe('when there is nothing to draw', () => {
  it('says so rather than rendering an empty box', () => {
    const wrapper = chart({ series: [] });
    expect(wrapper.find('svg').exists()).toBe(false);
    expect(wrapper.find('.empty').text()).toContain('Nothing recorded');
  });

  it('says so for a series that is all gaps', () => {
    const wrapper = chart({
      series: [{ key: 'temperature', label: 'At 5 m', points: [{ x: 0, y: null }] }],
    });
    expect(wrapper.find('.empty').exists()).toBe(true);
  });
});

describe('axes', () => {
  it('draws grid lines and tick labels', () => {
    const wrapper = chart();
    expect(wrapper.findAll('line.grid').length).toBeGreaterThanOrEqual(3);
    expect(wrapper.findAll('.axis text').length).toBeGreaterThanOrEqual(6);
  });

  it('formats the ticks the way it was told to', () => {
    const wrapper = chart({ formatX: (value: number) => `w${value}` });
    expect(wrapper.find('.axis').text()).toContain('w');
  });

  it('takes a forced extent so an axis does not float', () => {
    const floating = chart();
    const forced = chart({ yExtent: { min: 0, max: 30 } });
    expect(forced.find('.axis').text()).not.toBe(floating.find('.axis').text());
    expect(forced.find('.axis').text()).toContain('30');
  });

  it('renders the axis labels when given them', () => {
    const wrapper = chart({ xLabel: 'Week at sea', yLabel: 'Degrees' });
    expect(wrapper.find('.axisLabels').text()).toContain('Week at sea');
    expect(wrapper.find('.axisLabels').text()).toContain('Degrees');
  });
});

describe('reference lines', () => {
  it('draws one per reference with a legend entry', () => {
    const wrapper = chart({
      references: [{ value: 12, label: 'Feeding threshold' }],
    });
    expect(wrapper.findAll('.reference')).toHaveLength(1);
    expect(wrapper.find('.legend').text()).toContain('Feeding threshold');
  });

  it('widens the axis so a reference outside the data still shows', () => {
    const wrapper = chart({ references: [{ value: 40, label: 'Ceiling' }] });
    expect(wrapper.find('.axis').text()).toContain('40');
  });

  it('draws none when there are none', () => {
    expect(chart().findAll('.reference')).toHaveLength(0);
  });
});

describe('large series', () => {
  it('thins a long trace rather than putting every node in the DOM', () => {
    const wrapper = chart({
      series: [{ key: 'temperature', label: 'Daily', points: ramp(7, 15, 600) }],
      maxPoints: 120,
    });
    const commands = wrapper.find('.trace').attributes('d')?.match(/[ML]/g) ?? [];
    expect(commands.length).toBeLessThanOrEqual(120);
    expect(commands.length).toBeGreaterThan(80);
  });
});

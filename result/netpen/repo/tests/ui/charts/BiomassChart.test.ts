import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { Component } from 'vue';

import BiomassChart, { type BiomassPoint } from '@/ui/charts/BiomassChart.vue';

const Chart = BiomassChart as unknown as Component;

function series(entries: readonly (readonly [number, number])[]): BiomassPoint[] {
  return entries.map(([weeksAhead, biomassT]) => ({ weeksAhead, biomassT }));
}

const CLIMBING = series([
  [-4, 1_600],
  [-2, 1_800],
  [0, 1_950],
  [4, 2_260],
  [8, 2_640],
  [12, 3_010],
]);

function chart(props: Record<string, unknown> = {}) {
  return mount(Chart, {
    props: {
      points: CLIMBING,
      limitT: 2_500,
      caption: 'Standing biomass against the licence',
      ...props,
    },
  });
}

describe('the frame', () => {
  it('draws into a viewBox rather than measuring the page', () => {
    expect(chart({ height: 260 }).find('svg').attributes('viewBox')).toBe('0 0 720 260');
  });

  it('names itself for a reader who cannot see it', () => {
    expect(chart().find('svg').attributes('aria-label')).toBe(
      'Standing biomass against the licence',
    );
  });

  it('marks where the record stops and the model starts', () => {
    const wrapper = chart();
    expect(wrapper.find('path.recorded').attributes('d')).toBeTruthy();
    expect(wrapper.find('path.projected').attributes('d')).toBeTruthy();
    expect(wrapper.find('line.today').exists()).toBe(true);
  });

  it('joins the projection onto the last recorded point, leaving no gap', () => {
    const wrapper = chart();
    const recorded = wrapper.find('path.recorded').attributes('d') ?? '';
    const projected = wrapper.find('path.projected').attributes('d') ?? '';
    const lastRecorded = recorded.split(' ').slice(-2).join(' ');
    expect(projected.startsWith(`M${lastRecorded.replace('L', '')}`)).toBe(true);
  });
});

describe('the licence', () => {
  it('draws it as a rule and says what it is', () => {
    const wrapper = chart();
    expect(wrapper.find('line.limit').exists()).toBe(true);
    expect(wrapper.find('.limitLabel').text()).toBe('Licence 2500 t');
  });

  it('keeps the licence inside the chart even on a site nowhere near it', () => {
    const wrapper = chart({ points: series([[0, 400]]), limitT: 2_500 });
    const y = Number(wrapper.find('line.limit').attributes('y1'));
    const svgHeight = 220;
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(svgHeight);
  });

  it('shades what sits above the ceiling rather than only crossing it', () => {
    const shading = chart().find('path.overshoot').attributes('d') ?? '';
    expect(shading.length).toBeGreaterThan(0);
    expect(shading).toContain('Z');
  });

  it('shades nothing on a site that never goes over', () => {
    const wrapper = chart({
      points: series([
        [0, 900],
        [8, 1_400],
      ]),
    });
    expect(wrapper.find('path.overshoot').exists()).toBe(false);
  });

  it('marks the week the site goes over', () => {
    expect(chart().find('line.breach').exists()).toBe(true);
  });

  it('marks no week where the projection stays inside', () => {
    const wrapper = chart({
      points: series([
        [0, 900],
        [8, 1_400],
      ]),
    });
    expect(wrapper.find('line.breach').exists()).toBe(false);
  });
});

describe('the axes', () => {
  it('counts weeks from now, signed, with now marked as now', () => {
    const labels = chart()
      .findAll('.axis text')
      .map((node) => node.text());
    expect(labels).toContain('now');
    expect(labels.some((label) => label.startsWith('+'))).toBe(true);
  });

  it('starts the biomass axis at zero, so the climb is not exaggerated', () => {
    const ticks = chart()
      .findAll('.axis text[text-anchor="end"]')
      .map((node) => Number(node.text()));
    expect(Math.min(...ticks)).toBe(0);
  });

  it('clips the series to the plot so a spike cannot run over the labels', () => {
    const wrapper = chart();
    const clip = wrapper.find('clipPath').attributes('id');
    expect(wrapper.find('g[clip-path]').attributes('clip-path')).toBe(`url(#${clip})`);
  });
});

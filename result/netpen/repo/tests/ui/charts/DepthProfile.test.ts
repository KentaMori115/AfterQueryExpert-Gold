import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { Component } from 'vue';

import DepthProfile, { type ProfilePoint } from '@/ui/charts/DepthProfile.vue';

const Chart = DepthProfile as unknown as Component;

function column(entries: readonly (readonly [number, number, number])[]): ProfilePoint[] {
  return entries.map(([depthM, temperatureC, saturationPercent]) => ({
    depthM,
    temperatureC,
    saturationPercent,
  }));
}

/** Warm and well oxygenated at the surface, colder and poorer underneath. */
const STRATIFIED = column([
  [1, 13.8, 101],
  [3, 13.6, 99],
  [5, 12.1, 92],
  [10, 9.4, 81],
  [15, 8.9, 74],
]);

function chart(props: Record<string, unknown> = {}) {
  return mount(Chart, {
    props: { points: STRATIFIED, caption: 'Water column at the cage', ...props },
  });
}

function pathPoints(d: string): { x: number; y: number }[] {
  return [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
  }));
}

describe('the orientation', () => {
  it('runs depth downwards, so the surface is at the top', () => {
    const wrapper = chart();
    const points = pathPoints(wrapper.find('path.temperature').attributes('d') ?? '');
    // One metre is drawn above fifteen metres.
    expect(points[0]!.y).toBeLessThan(points.at(-1)!.y);
  });

  it('sorts the readings by depth however they arrive', () => {
    const shuffled = chart({ points: [...STRATIFIED].reverse() });
    const points = pathPoints(shuffled.find('path.temperature').attributes('d') ?? '');
    expect(points.map((point) => point.y)).toEqual(
      [...points.map((p) => p.y)].sort((a, b) => a - b),
    );
  });

  it('puts the colder water to the left, since temperature is the x axis', () => {
    const points = pathPoints(chart().find('path.temperature').attributes('d') ?? '');
    expect(points.at(-1)!.x).toBeLessThan(points[0]!.x);
  });
});

describe('the two series', () => {
  it('draws temperature and oxygen on their own scales', () => {
    const wrapper = chart();
    expect(wrapper.find('path.temperature').attributes('d')).toBeTruthy();
    expect(wrapper.find('path.oxygen').attributes('d')).toBeTruthy();
  });

  it('labels the oxygen range at the foot rather than in a legend', () => {
    expect(chart().text()).toMatch(/O2 \d+ to \d+ %/);
  });

  it('marks each reading, and says what it was', () => {
    const wrapper = chart();
    expect(wrapper.findAll('circle')).toHaveLength(5);
    expect(wrapper.find('circle title').text()).toContain('1 m: 13.8 C, 101 % saturation');
  });
});

describe('the net', () => {
  it('draws where the net stops when the depth is known', () => {
    expect(chart({ netDepthM: 12 }).find('line.net').exists()).toBe(true);
  });

  it('leaves it out when it is not', () => {
    expect(chart().find('line.net').exists()).toBe(false);
  });

  it('keeps the net inside the plot even where it is below the deepest reading', () => {
    const wrapper = chart({ netDepthM: 22 });
    const y = Number(wrapper.find('line.net').attributes('y1'));
    expect(y).toBeLessThanOrEqual(240);
    expect(y).toBeGreaterThan(0);
  });
});

describe('stratification', () => {
  it('says how much the column is stratified, since that is what it is read for', () => {
    expect(chart().find('.strat').text()).toContain('4.9 C top to bottom');
  });

  it('says nothing about it on a single reading', () => {
    const wrapper = chart({ points: column([[5, 11, 95]]) });
    expect(wrapper.find('.strat').exists()).toBe(false);
  });
});

describe('the frame', () => {
  it('draws into a viewBox rather than measuring', () => {
    expect(chart({ height: 200 }).find('svg').attributes('viewBox')).toBe('0 0 360 200');
  });

  it('names itself for a reader who cannot see it', () => {
    expect(chart().find('svg').attributes('aria-label')).toBe('Water column at the cage');
  });
});

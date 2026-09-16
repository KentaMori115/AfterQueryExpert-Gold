import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { Component } from 'vue';

import LiceChart, { type WeeklyPoint } from '@/ui/charts/LiceChart.vue';

const Chart = LiceChart as unknown as Component;

function points(entries: readonly (readonly [number, number])[]): WeeklyPoint[] {
  return entries.map(([week, value], index) => ({
    week: { year: 2025, week },
    value,
    cycleWeek: index + 40,
  }));
}

function chart(props: Record<string, unknown> = {}) {
  return mount(Chart, {
    props: {
      caption: 'Adult female by week, pen 3',
      regime: 'norway',
      points: points([
        [13, 0.12],
        [14, 0.24],
        [15, 0.35],
        [16, 0.31],
        [17, 0.18],
      ]),
      ...props,
    },
  });
}

describe('rendering', () => {
  it('draws a bar per count', () => {
    expect(chart().findAll('rect.bar')).toHaveLength(5);
  });

  it('labels the figure and every bar', () => {
    const wrapper = chart();
    expect(wrapper.find('figcaption').text()).toBe('Adult female by week, pen 3');
    expect(wrapper.findAll('rect.bar title')).toHaveLength(5);
    expect(wrapper.find('rect.bar title').text()).toContain('Week 13');
  });

  it('says so when no counts have been filed', () => {
    const wrapper = chart({ points: [] });
    expect(wrapper.find('svg').exists()).toBe(false);
    expect(wrapper.find('.empty').text()).toContain('No counts filed');
  });

  it('draws into a viewBox rather than measuring', () => {
    expect(chart({ height: 260 }).find('svg').attributes('viewBox')).toBe('0 0 720 260');
  });
});

describe('the limit', () => {
  it('marks a bar over the limit differently', () => {
    // The Norwegian limit is 0.5 outside the spring window; nothing here is over.
    const summer = chart({
      points: points([
        [30, 0.4],
        [31, 0.7],
      ]),
    });
    const over = summer.findAll('rect.bar').filter((bar) => bar.classes().includes('over'));
    expect(over).toHaveLength(1);
  });

  it('tightens inside the spring window, catching a count that was fine before', () => {
    // 0.35 is inside 0.5 in week 15 and over 0.2 in week 16.
    const wrapper = chart({
      points: points([
        [15, 0.35],
        [16, 0.35],
      ]),
    });
    const bars = wrapper.findAll('rect.bar');
    expect(bars[0]!.classes()).not.toContain('over');
    expect(bars[1]!.classes()).toContain('over');
  });

  it('does not tighten under the Scottish rule', () => {
    const wrapper = chart({
      regime: 'scotland',
      points: points([
        [15, 0.35],
        [16, 0.35],
      ]),
    });
    for (const bar of wrapper.findAll('rect.bar')) {
      expect(bar.classes()).not.toContain('over');
    }
  });

  it('draws the limit as a step rather than a slope', () => {
    const wrapper = chart({
      points: points([
        [15, 0.1],
        [16, 0.1],
      ]),
    });
    const path = wrapper.find('path.limit').attributes('d') ?? '';
    // Two flat runs at different heights, joined by a vertical jump.
    const ys = [...path.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((match) => Number(match[1]));
    expect(new Set(ys).size).toBe(2);
  });

  it('draws a flat limit where the window does not change', () => {
    const wrapper = chart({
      points: points([
        [30, 0.1],
        [31, 0.1],
        [32, 0.1],
      ]),
    });
    const path = wrapper.find('path.limit').attributes('d') ?? '';
    const ys = [...path.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((match) => Number(match[1]));
    expect(new Set(ys).size).toBe(1);
  });
});

describe('axes', () => {
  it('counts the x axis in whole cycle weeks, never repeating a label', () => {
    const wrapper = chart();
    const labels = wrapper
      .findAll('.axis text')
      .map((node) => node.text())
      .filter((text) => text.startsWith('w'));
    expect(labels.length).toBeGreaterThan(1);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('does not repeat a label on a two week span either', () => {
    const wrapper = chart({
      points: points([
        [30, 0.1],
        [31, 0.1],
      ]),
    });
    const labels = wrapper
      .findAll('.axis text')
      .map((node) => node.text())
      .filter((text) => text.startsWith('w'));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('widens the y axis to hold the limit even on a clean pen', () => {
    const wrapper = chart({
      points: points([
        [30, 0.02],
        [31, 0.03],
      ]),
    });
    const ticks = wrapper
      .findAll('.axis text')
      .map((node) => Number(node.text()))
      .filter((value) => Number.isFinite(value));
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(0.5);
  });
});

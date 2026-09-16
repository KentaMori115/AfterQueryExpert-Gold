import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { Component } from 'vue';

import ChartAxes from '@/ui/charts/ChartAxes.vue';

const Axes = ChartAxes as unknown as Component;

const PLOT = { left: 44, right: 706, top: 10, bottom: 194 };

function axes(props: Record<string, unknown> = {}) {
  return mount(Axes, {
    props: {
      plot: PLOT,
      xTicks: [0, 5, 10],
      yTicks: [0, 4, 8, 12],
      toX: (value: number) => 44 + value * 10,
      toY: (value: number) => 194 - value * 10,
      ...props,
    },
  });
}

describe('the labels', () => {
  it('writes one per tick on each axis', () => {
    expect(axes().findAll('text')).toHaveLength(7);
  });

  it('hangs the vertical labels off the left of the plot', () => {
    const first = axes().find('text');
    expect(Number(first.attributes('x'))).toBeLessThan(PLOT.left);
    expect(first.attributes('text-anchor')).toBe('end');
  });

  it('centres the horizontal labels under their tick', () => {
    const labels = axes().findAll('text');
    const horizontal = labels.at(-1)!;
    expect(horizontal.attributes('text-anchor')).toBe('middle');
    expect(Number(horizontal.attributes('y'))).toBeGreaterThan(PLOT.bottom);
  });

  it('leaves the precision to whoever supplied the formatter', () => {
    const wrapper = axes({
      formatY: (value: number) => value.toFixed(2),
      formatX: (value: number) => `w${value}`,
    });
    expect(wrapper.text()).toContain('0.00');
    expect(wrapper.text()).toContain('w5');
  });

  it('writes the raw number where no formatter was given', () => {
    expect(axes().text()).toContain('12');
  });
});

describe('the grid', () => {
  it('stays off unless it is asked for', () => {
    expect(axes().findAll('line.grid')).toHaveLength(0);
  });

  it('draws a rule at each horizontal tick, across the plot', () => {
    const wrapper = axes({ grid: true });
    const lines = wrapper.findAll('line.grid');
    expect(lines).toHaveLength(4);
    expect(lines[0]!.attributes('x1')).toBe(String(PLOT.left));
    expect(lines[0]!.attributes('x2')).toBe(String(PLOT.right));
  });

  it('puts a rule at the same height as its label', () => {
    const wrapper = axes({ grid: true });
    const rule = Number(wrapper.find('line.grid').attributes('y1'));
    const label = Number(wrapper.find('text').attributes('y'));
    expect(Math.abs(label - rule)).toBeLessThanOrEqual(4);
  });
});

describe('an empty axis', () => {
  it('draws nothing rather than failing', () => {
    const wrapper = axes({ xTicks: [], yTicks: [] });
    expect(wrapper.findAll('text')).toHaveLength(0);
  });
});

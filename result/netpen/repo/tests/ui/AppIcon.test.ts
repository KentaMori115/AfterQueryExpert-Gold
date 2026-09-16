import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AppIcon from '@/ui/AppIcon.vue';
import { ICONS, iconNames } from '@/ui/icons';

describe('the icon set', () => {
  it('has a shape for every name', () => {
    expect(iconNames().length).toBeGreaterThanOrEqual(14);
    for (const name of iconNames()) {
      expect(ICONS[name].paths.length).toBeGreaterThan(0);
    }
  });

  it('draws every path inside the grid', () => {
    // Lower case path commands carry deltas rather than absolute positions, so
    // a legitimate value runs from -20 to 20 on a twenty unit grid. Anything
    // outside that is a typo, which is the mistake worth catching here.
    for (const name of iconNames()) {
      for (const path of ICONS[name].paths) {
        const numbers = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
        for (const value of numbers) {
          expect(value, `${name} strays outside the grid`).toBeGreaterThanOrEqual(-20);
          expect(value, `${name} strays outside the grid`).toBeLessThanOrEqual(20);
        }
      }
    }
  });

  it('keeps every filled detail inside the visible box', () => {
    for (const name of iconNames()) {
      for (const [cx, cy, r] of ICONS[name].dots ?? []) {
        expect(cx - r, `${name} dot runs off the left`).toBeGreaterThanOrEqual(0);
        expect(cx + r, `${name} dot runs off the right`).toBeLessThanOrEqual(20);
        expect(cy - r).toBeGreaterThanOrEqual(0);
        expect(cy + r).toBeLessThanOrEqual(20);
      }
    }
  });
});

describe('rendering', () => {
  it('renders the paths for the name given', () => {
    const wrapper = mount(AppIcon, { props: { name: 'louse' } });
    expect(wrapper.findAll('path')).toHaveLength(ICONS.louse.paths.length);
  });

  it('renders the filled details where a shape has them', () => {
    const wrapper = mount(AppIcon, { props: { name: 'alert' } });
    expect(wrapper.findAll('circle')).toHaveLength(1);
  });

  it('renders no circles where a shape has none', () => {
    expect(mount(AppIcon, { props: { name: 'chevron' } }).findAll('circle')).toHaveLength(0);
  });

  it('honours the size asked for', () => {
    const wrapper = mount(AppIcon, { props: { name: 'pen', size: 32 } });
    expect(wrapper.attributes('width')).toBe('32');
    expect(wrapper.attributes('height')).toBe('32');
  });
});

describe('accessibility', () => {
  it('is hidden from assistive technology by default', () => {
    const wrapper = mount(AppIcon, { props: { name: 'pen' } });
    expect(wrapper.attributes('aria-hidden')).toBe('true');
    expect(wrapper.attributes('role')).toBeUndefined();
  });

  it('becomes an image with a name when it carries the meaning alone', () => {
    const wrapper = mount(AppIcon, { props: { name: 'alert', label: 'Urgent' } });
    expect(wrapper.attributes('role')).toBe('img');
    expect(wrapper.attributes('aria-label')).toBe('Urgent');
    expect(wrapper.attributes('aria-hidden')).toBeUndefined();
  });

  it('is never in the tab order', () => {
    expect(mount(AppIcon, { props: { name: 'pen' } }).attributes('focusable')).toBe('false');
  });
});

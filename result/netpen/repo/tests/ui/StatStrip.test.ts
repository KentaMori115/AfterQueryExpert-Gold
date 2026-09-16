import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import StatStrip from '@/ui/StatStrip.vue';

function strip(props: Record<string, unknown> = {}) {
  return mount(StatStrip, {
    props,
    slots: { default: '<p class="tile">One</p><p class="tile">Two</p>' },
  });
}

describe('the strip', () => {
  it('renders what it was given, in order', () => {
    const tiles = strip().findAll('.tile');
    expect(tiles.map((tile) => tile.text())).toEqual(['One', 'Two']);
  });

  it('carries a default track width, so five views cannot drift apart', () => {
    expect(strip().attributes('style')).toContain('--strip-min: 180px');
  });

  it('lets a screen with longer figures ask for wider tracks', () => {
    expect(strip({ minWidth: '240px' }).attributes('style')).toContain('--strip-min: 240px');
  });

  it('is a plain wrapper, adding nothing of its own to the markup', () => {
    const wrapper = strip();
    expect(wrapper.element.children).toHaveLength(2);
  });
});

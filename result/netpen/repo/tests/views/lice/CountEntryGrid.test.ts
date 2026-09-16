import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { EMPTY_FISH, type FishCount } from '@/domain/lice/counts';
import CountEntryGrid from '@/views/lice/CountEntryGrid.vue';

function sampleOf(fish: number, adultFemale = 0): FishCount[] {
  return Array.from({ length: fish }, () => ({ ...EMPTY_FISH, adultFemale }));
}

function grid(sample = sampleOf(20)) {
  return mount(CountEntryGrid, { props: { sample } });
}

describe('the shape of the grid', () => {
  it('runs a row per stage and a column per fish', () => {
    const wrapper = grid(sampleOf(20));
    expect(wrapper.findAll('tbody tr')).toHaveLength(5);
    expect(wrapper.findAll('tbody tr:first-child input')).toHaveLength(20);
  });

  it('leads with adult females, since that is the regulated stage', () => {
    expect(grid().find('tbody th').text()).toBe('Adult female');
  });

  it('labels every box, since a bare number input tells a screen reader nothing', () => {
    const first = grid().find('tbody input');
    expect(first.attributes('aria-label')).toBe('Adult female, fish 1');
  });

  it('numbers the fish along the top', () => {
    const headers = grid(sampleOf(3)).findAll('thead th').slice(1, -1);
    expect(headers.map((node) => node.text())).toEqual(['1', '2', '3']);
  });
});

describe('typing into it', () => {
  it('sends the whole sample back rather than mutating what it was given', async () => {
    const sample = sampleOf(3);
    const wrapper = grid(sample);
    await wrapper.find('tbody input').setValue('4');

    const emitted = wrapper.emitted('update:sample')?.[0]?.[0] as FishCount[];
    expect(emitted[0]?.adultFemale).toBe(4);
    expect(sample[0]?.adultFemale).toBe(0);
  });

  it('leaves the other fish alone', async () => {
    const wrapper = grid(sampleOf(3, 1));
    await wrapper.findAll('tbody input')[1]!.setValue('7');

    const emitted = wrapper.emitted('update:sample')?.[0]?.[0] as FishCount[];
    expect(emitted.map((fish) => fish.adultFemale)).toEqual([1, 7, 1]);
  });

  it('reads a cleared box as nothing counted rather than as a gap', async () => {
    const wrapper = grid(sampleOf(2, 3));
    await wrapper.find('tbody input').setValue('');

    const emitted = wrapper.emitted('update:sample')?.[0]?.[0] as FishCount[];
    expect(emitted[0]?.adultFemale).toBe(0);
  });

  it('refuses a negative, which is a slipped minus key rather than a count', async () => {
    const wrapper = grid(sampleOf(2));
    await wrapper.find('tbody input').setValue('-3');

    const emitted = wrapper.emitted('update:sample')?.[0]?.[0] as FishCount[];
    expect(emitted[0]?.adultFemale).toBe(0);
  });
});

describe('the running means', () => {
  it('shows a mean per stage so a mistyped figure is visible before saving', () => {
    const sample = sampleOf(4, 1);
    sample[0] = { ...sample[0]!, adultFemale: 10 };
    const wrapper = mount(CountEntryGrid, { props: { sample } });
    expect(wrapper.find('tbody .mean').text()).toBe('3.25');
  });

  it('totals the lice on the table, caligus excluded', () => {
    const sample = sampleOf(2, 2).map((fish) => ({ ...fish, caligus: 5 }));
    const wrapper = mount(CountEntryGrid, { props: { sample } });
    expect(wrapper.find('.total').text()).toBe('4 lice on the table');
  });
});

describe('the sample size', () => {
  it('says how many fish are on the table', () => {
    expect(grid(sampleOf(20)).find('.counted').text()).toContain('20 of 20 fish');
  });

  it('warns when the count is short of what the regime asks for', () => {
    const wrapper = grid(sampleOf(12));
    expect(wrapper.find('.counted').classes()).toContain('short');
    expect(wrapper.find('.counted').text()).toContain('below what the regime asks for');
  });

  it('adds a fish when asked', async () => {
    const wrapper = grid(sampleOf(2));
    await wrapper.findAll('button')[1]!.trigger('click');
    expect((wrapper.emitted('update:sample')?.[0]?.[0] as FishCount[]).length).toBe(3);
  });

  it('takes one off, but never the last one', async () => {
    const wrapper = grid(sampleOf(2));
    await wrapper.findAll('button')[0]!.trigger('click');
    expect((wrapper.emitted('update:sample')?.[0]?.[0] as FishCount[]).length).toBe(1);

    const single = grid(sampleOf(1));
    await single.findAll('button')[0]!.trigger('click');
    expect(single.emitted('update:sample')).toBeUndefined();
  });
});

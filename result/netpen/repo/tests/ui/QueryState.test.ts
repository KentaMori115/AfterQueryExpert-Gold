import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { Component } from 'vue';

import { ApiError } from '@/data/http';
import EmptyState from '@/ui/EmptyState.vue';
import ErrorState from '@/ui/ErrorState.vue';
import LoadingBars from '@/ui/LoadingBars.vue';
import QueryState from '@/ui/QueryState.vue';

const Ladder = QueryState as unknown as Component;

function ladder(props: Record<string, unknown>) {
  return mount(Ladder, {
    props: {
      loading: false,
      error: null,
      data: ['pen-1'],
      isEmpty: (rows: string[]) => rows.length === 0,
      emptyTitle: 'No pens stocked',
      ...props,
    },
    slots: {
      default:
        '<template #default="{ data }"><ul><li v-for="d in data" :key="d">{{ d }}</li></ul></template>',
    },
  });
}

describe('the order of the ladder', () => {
  it('shows the loading bars while loading, even with stale data present', () => {
    const wrapper = ladder({ loading: true });
    expect(wrapper.findComponent(LoadingBars).exists()).toBe(true);
    expect(wrapper.find('ul').exists()).toBe(false);
  });

  it('shows the error ahead of the empty state', () => {
    const wrapper = ladder({ error: new Error('boom'), data: [] });
    expect(wrapper.findComponent(ErrorState).exists()).toBe(true);
    expect(wrapper.findComponent(EmptyState).exists()).toBe(false);
  });

  it('distinguishes empty from broken', () => {
    const wrapper = ladder({ data: [] });
    expect(wrapper.findComponent(EmptyState).exists()).toBe(true);
    expect(wrapper.text()).toContain('No pens stocked');
    expect(wrapper.findComponent(ErrorState).exists()).toBe(false);
  });

  it('treats data that never came back as an error rather than as empty', () => {
    const wrapper = ladder({ data: undefined });
    expect(wrapper.findComponent(ErrorState).exists()).toBe(true);
  });

  it('renders the slot once there is data', () => {
    expect(
      ladder({})
        .findAll('li')
        .map((item) => item.text()),
    ).toEqual(['pen-1']);
  });

  it('renders the slot when nothing said how to judge emptiness', () => {
    const wrapper = ladder({ data: [], isEmpty: undefined });
    expect(wrapper.findComponent(EmptyState).exists()).toBe(false);
  });
});

describe('the loading bars', () => {
  it('announce themselves politely', () => {
    const wrapper = mount(LoadingBars);
    expect(wrapper.attributes('role')).toBe('status');
    expect(wrapper.attributes('aria-live')).toBe('polite');
    expect(wrapper.attributes('aria-label')).toBe('Loading');
  });

  it('take a label so the announcement says what is loading', () => {
    expect(
      mount(LoadingBars, { props: { label: 'Loading counts' } }).attributes('aria-label'),
    ).toBe('Loading counts');
  });

  it('render the number of bars asked for', () => {
    expect(mount(LoadingBars, { props: { lines: 5 } }).findAll('.bar')).toHaveLength(5);
  });
});

describe('the error state', () => {
  it('is announced as an alert', () => {
    expect(mount(ErrorState, { props: { error: new Error('boom') } }).attributes('role')).toBe(
      'alert',
    );
  });

  it('words a dropped link differently from a broken server', () => {
    const offline = mount(ErrorState, {
      props: { error: new ApiError('offline', 'No link to shore') },
    });
    const broken = mount(ErrorState, { props: { error: new ApiError('server', 'Broken') } });

    expect(offline.text()).toContain('No link to shore');
    expect(offline.classes()).toContain('offline');
    expect(broken.text()).toContain('Could not load this');
    expect(broken.classes()).not.toContain('offline');
  });

  it('offers a retry that reaches the caller', async () => {
    const wrapper = mount(ErrorState, { props: { error: new Error('boom') } });
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });

  it('takes a title of its own where the screen knows better', () => {
    const wrapper = mount(ErrorState, {
      props: { error: new Error('boom'), title: 'Could not file the count' },
    });
    expect(wrapper.text()).toContain('Could not file the count');
  });
});

describe('the empty state', () => {
  it('shows a title, and a body only when there is one', () => {
    expect(mount(EmptyState, { props: { title: 'Nothing here' } }).text()).toBe('Nothing here');
    expect(
      mount(EmptyState, { props: { title: 'Nothing here', body: 'Try another week.' } }).text(),
    ).toContain('Try another week.');
  });

  it('renders an action when one is offered', () => {
    const wrapper = mount(EmptyState, {
      props: { title: 'Nothing here' },
      slots: { action: '<button>File a count</button>' },
    });
    expect(wrapper.find('button').text()).toBe('File a count');
  });
});

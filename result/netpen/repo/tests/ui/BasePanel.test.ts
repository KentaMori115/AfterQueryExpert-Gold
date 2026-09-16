import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import BasePanel from '@/ui/BasePanel.vue';

describe('structure', () => {
  it('renders its default slot', () => {
    expect(mount(BasePanel, { slots: { default: 'Body' } }).text()).toContain('Body');
  });

  it('renders a heading when given a title', () => {
    const wrapper = mount(BasePanel, { props: { title: 'Lice' }, slots: { default: 'x' } });
    expect(wrapper.find('h2').text()).toBe('Lice');
  });

  it('omits the header with no title and no actions', () => {
    expect(
      mount(BasePanel, { slots: { default: 'x' } })
        .find('header')
        .exists(),
    ).toBe(false);
  });

  it('renders a header for actions alone', () => {
    const wrapper = mount(BasePanel, {
      slots: { default: 'x', actions: '<button>Export</button>' },
    });
    expect(wrapper.find('header').exists()).toBe(true);
    expect(wrapper.find('button').text()).toBe('Export');
  });

  it('renders a subtitle and a footer when given them', () => {
    const wrapper = mount(BasePanel, {
      props: { title: 'Feed', subtitle: 'Today' },
      slots: { default: 'x', footer: 'Ordered Tuesday' },
    });
    expect(wrapper.text()).toContain('Today');
    expect(wrapper.find('footer').text()).toBe('Ordered Tuesday');
  });

  it('omits the footer when not given one', () => {
    expect(
      mount(BasePanel, { slots: { default: 'x' } })
        .find('footer')
        .exists(),
    ).toBe(false);
  });
});

describe('accessibility', () => {
  it('is a region labelled by its heading', () => {
    const wrapper = mount(BasePanel, { props: { title: 'Water' }, slots: { default: 'x' } });
    const section = wrapper.find('section');
    expect(section.attributes('aria-labelledby')).toBe(wrapper.find('h2').attributes('id'));
  });

  it('does not claim a label it does not have', () => {
    const wrapper = mount(BasePanel, { slots: { default: 'x' } });
    expect(wrapper.find('section').attributes('aria-labelledby')).toBeUndefined();
  });
});

describe('tones and density', () => {
  it('marks an alarming panel differently from a plain one', () => {
    const plain = mount(BasePanel, { slots: { default: 'x' } });
    const alarm = mount(BasePanel, { props: { tone: 'alarm' }, slots: { default: 'x' } });
    expect(plain.find('section').classes()).toContain('plain');
    expect(alarm.find('section').classes()).toContain('alarm');
  });

  it('distinguishes caution from alarm', () => {
    const caution = mount(BasePanel, { props: { tone: 'caution' }, slots: { default: 'x' } });
    expect(caution.find('section').classes()).toContain('caution');
    expect(caution.find('section').classes()).not.toContain('alarm');
  });

  it('drops the body padding for a table', () => {
    const tight = mount(BasePanel, { props: { tight: true }, slots: { default: 'x' } });
    expect(tight.find('.body').classes()).toContain('tight');
    expect(
      mount(BasePanel, { slots: { default: 'x' } })
        .find('.body')
        .classes(),
    ).not.toContain('tight');
  });
});

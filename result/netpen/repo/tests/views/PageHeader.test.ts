import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PageHeader from '@/views/PageHeader.vue';

function header(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  return mount(PageHeader, { props: { title: 'Lice register', ...props }, slots });
}

describe('the heading', () => {
  it('renders the title as the page heading', () => {
    expect(header().find('h2').text()).toBe('Lice register');
  });

  it('leaves the standfirst out when there is none', () => {
    expect(header().find('.note').exists()).toBe(false);
  });

  it('collapses a note written across several lines in the template', () => {
    const wrapper = header({ note: 'Ordered by urgency,\n        not by when it was raised.' });
    expect(wrapper.find('.note').text()).toBe('Ordered by urgency, not by when it was raised.');
  });

  it('takes a note as markup where one needs a figure in it', () => {
    const wrapper = header({}, { note: '<p class="note">Limit is <b>0.50</b> this week.</p>' });
    expect(wrapper.find('.note b').text()).toBe('0.50');
  });
});

describe('the actions', () => {
  it('renders nothing on the right when nothing was put there', () => {
    expect(header().find('.actions').exists()).toBe(false);
  });

  it('renders what it was given on the right', () => {
    const wrapper = header({}, { actions: '<button class="go">Export</button>' });
    expect(wrapper.find('.actions .go').text()).toBe('Export');
  });
});

import { describe, expect, it } from 'vitest';

import NotFoundView from '@/views/NotFoundView.vue';

import { mountView } from '../support/mount';

async function lost(path: string) {
  const { wrapper } = await mountView(NotFoundView, { path });
  return wrapper;
}

describe('what it says', () => {
  it('quotes the address that was asked for', async () => {
    const wrapper = await lost('/pens/pen-3/history');
    expect(wrapper.find('code').text()).toBe('/pens/pen-3/history');
  });

  it('keeps the query string, since that is often where the typo is', async () => {
    const wrapper = await lost('/register?week=41');
    expect(wrapper.find('code').text()).toContain('week=41');
  });

  it('offers the places worth going', async () => {
    const wrapper = await lost('/nowhere');
    const links = wrapper.findAll('.destinations a').map((link) => link.attributes('href'));
    expect(links).toEqual(['/pens', '/lice', '/biomass', '/alerts']);
  });
});

describe('guessing at a pen', () => {
  it('offers the address this site would use when a pen was clearly meant', async () => {
    const wrapper = await lost('/pens/7');
    expect(wrapper.find('.guess a').attributes('href')).toBe('/pens/pen-7');
  });

  it('pulls the number out of a mangled identifier', async () => {
    const wrapper = await lost('/pens/pen-3)');
    expect(wrapper.find('.guess a').attributes('href')).toBe('/pens/pen-3');
  });

  it('guesses nothing where there is no number to work from', async () => {
    const wrapper = await lost('/pens/whatever');
    expect(wrapper.find('.guess').exists()).toBe(false);
  });

  it('guesses nothing on an address that was never about a pen', async () => {
    const wrapper = await lost('/reports/2025');
    expect(wrapper.find('.guess').exists()).toBe(false);
  });
});

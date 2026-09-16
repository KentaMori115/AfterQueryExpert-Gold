import { setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearStoredPreferences } from '@/app/stores/preferences';
import { RefusedError } from '@/data/api';
import type { PenView } from '@/data/projections/pen';
import type { Alert } from '@/domain/alerts/types';
import type { Site } from '@/domain/site/types';
import PenDetailView from '@/views/PenDetailView.vue';

import { mountView, settle } from '../support/mount';
import { penView } from '../support/penView';

const SITE = { regime: 'norway', name: 'Eilean Dubh' } as Site;

function alertOn(penId: string): Alert {
  return { subject: { type: 'pen', penId, siteId: 'site-1' } } as unknown as Alert;
}

async function page(view: PenView = penView({ number: 3 }), alerts: Alert[] = []) {
  const { wrapper, router } = await mountView(PenDetailView, {
    path: '/pens/pen-3',
    api: {
      getPen: () => Promise.resolve(view),
      getSite: () => Promise.resolve(SITE),
      listAlerts: () => Promise.resolve(alerts),
    },
  });
  await settle(wrapper, 8);
  return { wrapper, router };
}

afterEach(() => {
  clearStoredPreferences();
  setActivePinia(undefined);
});

describe('the page', () => {
  it('reads the pen out of the route', async () => {
    const getPen = vi.fn(() => Promise.resolve(penView({ number: 3 })));
    const { wrapper } = await mountView(PenDetailView, {
      path: '/pens/pen-3',
      api: { getPen, getSite: () => Promise.resolve(SITE), listAlerts: () => Promise.resolve([]) },
    });
    await settle(wrapper, 8);
    expect(getPen).toHaveBeenCalledWith('pen-3', expect.any(Number));
  });

  it('puts the panels in the order a pen is worked through', async () => {
    const { wrapper } = await page();
    const titles = wrapper.findAll('.panel h3, .panel h2').map((node) => node.text());
    expect(titles).toEqual(['Sea lice', 'Feed', 'Health']);
  });

  it('offers a way back to the board', async () => {
    const { wrapper } = await page();
    expect(wrapper.find('.back').attributes('href')).toBe('/pens');
  });

  it('shows a skeleton rather than a half drawn page while it loads', async () => {
    const { wrapper } = await mountView(PenDetailView, {
      path: '/pens/pen-3',
      api: {
        getPen: () => new Promise<PenView>(() => {}),
        getSite: () => Promise.resolve(SITE),
        listAlerts: () => Promise.resolve([]),
      },
    });
    expect(wrapper.find('[role="status"] .bar').exists()).toBe(true);
    expect(wrapper.find('.pen').exists()).toBe(false);
  });

  it('offers a retry when the pen cannot be fetched', async () => {
    const { wrapper } = await mountView(PenDetailView, {
      path: '/pens/pen-3',
      api: {
        getPen: () => Promise.reject(new RefusedError('no', 'role-not-permitted')),
        getSite: () => Promise.resolve(SITE),
        listAlerts: () => Promise.resolve([]),
      },
    });
    await settle(wrapper, 12);
    expect(wrapper.find('button.retry').exists()).toBe(true);
  });
});

describe('alerts', () => {
  it('counts only the alerts raised against this pen', async () => {
    const { wrapper } = await page(penView({ number: 3 }), [
      alertOn('pen-3'),
      alertOn('pen-3'),
      alertOn('pen-5'),
    ]);
    expect(wrapper.find('.alerts').text()).toContain('2');
  });

  it('stays quiet when the pen has none of its own', async () => {
    const { wrapper } = await page(penView({ number: 3 }), [alertOn('pen-5')]);
    expect(wrapper.find('.alerts').exists()).toBe(false);
  });
});

describe('the regime', () => {
  it('takes the lice limit from the site rather than assuming one', async () => {
    const { wrapper } = await mountView(PenDetailView, {
      path: '/pens/pen-3',
      api: {
        getPen: () => Promise.resolve(penView({ number: 3, countedAt: Date.UTC(2025, 3, 30) })),
        getSite: () => Promise.resolve({ ...SITE, regime: 'scotland' } as Site),
        listAlerts: () => Promise.resolve([]),
      },
    });
    await settle(wrapper, 8);
    expect(wrapper.find('.limit').text()).toContain('0.50');
  });
});

describe('recording something', () => {
  it('keeps both forms shut until one is asked for', async () => {
    const { wrapper } = await page();
    expect(wrapper.find('dialog').exists()).toBe(false);
  });

  it('opens the treatment form from the health panel', async () => {
    const { wrapper } = await page();
    const buttons = wrapper.findAll('.actions button');
    await buttons.find((button) => button.text() === 'Record a treatment')?.trigger('click');
    await settle(wrapper, 4);
    expect(wrapper.find('dialog h2').text()).toBe('Record a treatment');
  });

  it('opens the mortality form from the same place', async () => {
    const { wrapper } = await page();
    const buttons = wrapper.findAll('.actions button');
    await buttons.find((button) => button.text() === 'Record mortality')?.trigger('click');
    await settle(wrapper, 4);
    expect(wrapper.find('dialog h2').text()).toBe('Record mortality');
  });

  it('opens one form at a time', async () => {
    const { wrapper } = await page();
    await wrapper.findAll('.actions button')[0]!.trigger('click');
    await settle(wrapper, 4);
    expect(wrapper.findAll('dialog')).toHaveLength(1);
  });

  it('shuts a form left open when the route moves to another pen', async () => {
    const { wrapper, router } = await page();
    await wrapper.findAll('.actions button')[0]!.trigger('click');
    await settle(wrapper, 4);

    await router.push('/pens/pen-4');
    await settle(wrapper, 8);
    expect(wrapper.find('dialog').exists()).toBe(false);
  });
});

describe('appetite', () => {
  it('starts at normal and follows what the crew choose', async () => {
    const { wrapper } = await page();
    expect((wrapper.find('input:checked').element as HTMLInputElement).value).toBe('normal');

    const slow = wrapper.findAll('input').find((input) => input.element.value === 'slow');
    await slow?.setValue(true);
    expect((wrapper.find('input:checked').element as HTMLInputElement).value).toBe('slow');
  });

  it('does not carry an observation from one pen onto the next', async () => {
    const { wrapper, router } = await page();
    const slow = wrapper.findAll('input').find((input) => input.element.value === 'slow');
    await slow?.setValue(true);

    await router.push('/pens/pen-4');
    await settle(wrapper, 8);
    expect((wrapper.find('input:checked').element as HTMLInputElement).value).toBe('normal');
  });
});

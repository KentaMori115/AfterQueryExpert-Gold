import { describe, expect, it } from 'vitest';

import type { Alert } from '@/domain/alerts/types';
import AlertRow from '@/views/alerts/AlertRow.vue';

import { alert } from '../../support/alerts';
import { mountView } from '../../support/mount';
import { TEST_NOW } from '../../support/penView';

const DAY = 86_400_000;

async function row(value: Alert = alert(), acknowledging = false) {
  const { wrapper } = await mountView(AlertRow, {
    props: { alert: value, now: TEST_NOW, acknowledging },
  });
  return wrapper;
}

describe('the row', () => {
  it('names the kind of alert rather than only its message', async () => {
    expect((await row()).find('.badge').text()).toBe('Lice over the limit');
  });

  it('carries the message the rule wrote', async () => {
    const wrapper = await row(alert({ message: 'Oxygen touched 48 per cent at 15:40.' }));
    expect(wrapper.find('.message').text()).toBe('Oxygen touched 48 per cent at 15:40.');
  });

  it('links through to the pen it was raised against', async () => {
    const wrapper = await row(alert({ penNumber: 5 }));
    expect(wrapper.find('.pen').attributes('href')).toBe('/pens/pen-5');
    expect(wrapper.find('.pen').text()).toBe('Pen 5');
  });

  it('has no pen link on a site alert', async () => {
    const wrapper = await row(alert({ kind: 'biomass-over-licence', penNumber: null }));
    expect(wrapper.find('.pen').exists()).toBe(false);
  });

  it('shows what was observed against what the limit was', async () => {
    expect((await row()).find('.meta').text()).toContain('0.62 against 0.50');
  });

  it('shows the observed figure alone where there is no limit to compare it to', async () => {
    const wrapper = await row(alert({ kind: 'net-due-for-change', observed: 340, limit: null }));
    expect(wrapper.find('.meta').text()).toContain('340.00');
    expect(wrapper.find('.meta').text()).not.toContain('against');
  });

  it('takes its colour from the severity', async () => {
    expect((await row(alert({ severity: 'urgent' }))).find('.row').classes()).toContain('urgent');
    expect((await row(alert({ severity: 'info' }))).find('.row').classes()).toContain('info');
  });
});

describe('regulatory alerts', () => {
  it('says so, since acknowledging one changes nothing about the obligation', async () => {
    expect((await row()).find('.regulatory').exists()).toBe(true);
  });

  it('says nothing on an alert that is only the operator business', async () => {
    const wrapper = await row(alert({ kind: 'net-due-for-change' }));
    expect(wrapper.find('.regulatory').exists()).toBe(false);
  });
});

describe('deadlines', () => {
  it('says when it has to be acted on', async () => {
    const wrapper = await row(alert({ actByAt: TEST_NOW + 4 * DAY }));
    expect(wrapper.find('.meta').text()).toContain('Act by');
  });

  it('says plainly when the deadline has gone', async () => {
    const wrapper = await row(alert({ actByAt: TEST_NOW - DAY }));
    expect(wrapper.find('.passed').text()).toContain('Deadline passed');
  });
});

describe('acknowledgement', () => {
  it('offers to take an open alert on', async () => {
    const wrapper = await row();
    expect(wrapper.find('button').text()).toBe('Take it on');
  });

  it('names the alert when it asks the parent to acknowledge it', async () => {
    const wrapper = await row(alert({ id: 'alert-99' }));
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('acknowledge')?.[0]).toEqual(['alert-99']);
  });

  it('keeps an acknowledged alert on the list with a name against it', async () => {
    const wrapper = await row(
      alert({ acknowledgedAt: TEST_NOW - 3_600_000, acknowledgedBy: 'A. Tait' }),
    );
    expect(wrapper.find('.by').text()).toContain('Taken by A. Tait');
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('says it is working while the write is in flight', async () => {
    const wrapper = await row(alert(), true);
    expect(wrapper.find('button').text()).toBe('Taking');
    expect(wrapper.find('button').attributes('disabled')).toBeDefined();
  });

  it('offers nothing on a cleared alert, and dims it', async () => {
    const wrapper = await row(alert({ clearedAt: TEST_NOW - 3_600_000 }));
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.find('.row').classes()).toContain('cleared');
    expect(wrapper.find('.meta').text()).toContain('Cleared');
  });
});

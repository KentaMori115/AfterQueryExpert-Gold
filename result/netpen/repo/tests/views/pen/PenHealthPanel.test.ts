import { describe, expect, it } from 'vitest';

import PenHealthPanel from '@/views/pen/PenHealthPanel.vue';

import { mountView } from '../../support/mount';
import { penView } from '../../support/penView';

async function health(view = penView()) {
  const { wrapper } = await mountView(PenHealthPanel, { props: { view } });
  return wrapper;
}

describe('mortality', () => {
  it('leads with the cumulative figure and the level beside it', async () => {
    const wrapper = await health(penView({ mortalityLevel: 'elevated' }));
    expect(wrapper.find('.value').text()).toBe('1.90 %');
    expect(wrapper.find('.badge').text()).toBe('elevated');
    expect(wrapper.find('.badge').classes()).toContain('caution');
  });

  it('gives the daily rate to three places, since it is a small number', async () => {
    expect((await health()).find('.daily').text()).toContain('0.008 %');
  });
});

describe('the withdrawal', () => {
  it('is not drawn at all when the pen has never been treated', async () => {
    expect((await health()).find('.withdrawal').exists()).toBe(false);
  });

  it('counts the degree days still to serve', async () => {
    const wrapper = await health(
      penView({
        treatments: [{ method: 'emamectin-benzoate' }],
        withdrawalRemaining: 62,
      }),
    );
    expect(wrapper.find('.remaining').text()).toContain('62 degree days left');
  });

  it('names the method the withdrawal is running on', async () => {
    const wrapper = await health(
      penView({ treatments: [{ method: 'emamectin-benzoate' }], withdrawalRemaining: 62 }),
    );
    expect(wrapper.find('.name').text()).toContain('Emamectin benzoate');
  });

  it('fills the bar in proportion to what has been served', async () => {
    const wrapper = await health(
      penView({ treatments: [{ method: 'emamectin-benzoate' }], withdrawalRemaining: 87.5 }),
    );
    expect(wrapper.find('.level').attributes('style')).toContain('50%');
  });

  it('says plainly that the pen cannot be harvested while it is blocked', async () => {
    const wrapper = await health(
      penView({
        treatments: [{ method: 'emamectin-benzoate' }],
        withdrawalRemaining: 62,
        blocking: true,
      }),
    );
    expect(wrapper.find('.warn').text()).toContain('cannot be harvested');
    expect(wrapper.find('.withdrawal').classes()).toContain('blocked');
  });

  it('says cleared once it is served, rather than hiding the row', async () => {
    const wrapper = await health(
      penView({ treatments: [{ method: 'thermal' }], withdrawalRemaining: 0 }),
    );
    expect(wrapper.find('.cleared').text()).toBe('Cleared');
    expect(wrapper.find('.warn').exists()).toBe(false);
  });
});

describe('the treatment record', () => {
  it('says nothing has been given rather than showing an empty table', async () => {
    expect((await health()).text()).toContain('No treatment has been given');
  });

  it('lists a row per treatment with the counts either side', async () => {
    const wrapper = await health(
      penView({ treatments: [{ beforeCount: 0.62, afterCount: 0.11 }, { method: 'freshwater' }] }),
    );
    expect(wrapper.findAll('tbody tr')).toHaveLength(2);
    expect(wrapper.text()).toContain('0.62');
    expect(wrapper.text()).toContain('0.11');
  });

  it('works out the reduction that was actually achieved', async () => {
    const wrapper = await health(penView({ treatments: [{ beforeCount: 0.6, afterCount: 0.15 }] }));
    expect(wrapper.text()).toContain('75 %');
  });

  it('marks a treatment that fell well short of what the method usually gives', async () => {
    const wrapper = await health(
      penView({ treatments: [{ method: 'thermal', beforeCount: 0.6, afterCount: 0.45 }] }),
    );
    expect(wrapper.find('.poor').exists()).toBe(true);
  });

  it('leaves the reduction blank rather than guessing when a count is missing', async () => {
    const wrapper = await health(penView({ treatments: [{ beforeCount: 0.6, afterCount: null }] }));
    expect(wrapper.find('td:last-child').text()).toBe('—');
    expect(wrapper.find('.poor').exists()).toBe(false);
  });
});

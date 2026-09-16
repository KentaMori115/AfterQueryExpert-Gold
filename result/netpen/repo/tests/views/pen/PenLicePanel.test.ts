import { describe, expect, it } from 'vitest';

import type { Regime } from '@/domain/lice/thresholds';
import PenLicePanel from '@/views/pen/PenLicePanel.vue';

import { mountView } from '../../support/mount';
import { clusteredSample, evenSample, penView } from '../../support/penView';

/** Inside and outside the Norwegian spring window, weeks 16 to 21. */
const SPRING = Date.UTC(2025, 3, 30);
const SUMMER = Date.UTC(2025, 6, 22);

async function panel(view = penView(), regime: Regime = 'norway') {
  const { wrapper } = await mountView(PenLicePanel, { props: { view, regime } });
  return wrapper;
}

describe('the headline', () => {
  it('leads with adult females, since that is what the limit is written against', async () => {
    const wrapper = await panel(penView({ adultFemale: 0.34 }));
    expect(wrapper.find('.value').text()).toBe('0.34');
    expect(wrapper.find('.label').text()).toContain('adult female per fish');
  });

  it('says who counted and when', async () => {
    const wrapper = await panel(penView({ countedBy: 'M. Sinclair' }));
    expect(wrapper.text()).toContain('M. Sinclair');
  });

  it('reads the limit off the week the count was taken, not a constant', async () => {
    const spring = await panel(penView({ countedAt: SPRING }));
    expect(spring.find('.limit').text()).toContain('0.20');

    const summer = await panel(penView({ countedAt: SUMMER }));
    expect(summer.find('.limit').text()).toContain('0.50');
  });

  it('does not tighten the limit under the Scottish rule', async () => {
    const wrapper = await panel(penView({ countedAt: SPRING }), 'scotland');
    expect(wrapper.find('.limit').text()).toContain('0.50');
  });

  it('counts the weeks a pen has been over', async () => {
    const wrapper = await panel(penView({ liceStatus: 'over-limit', weeksOver: 3 }));
    expect(wrapper.find('.over').text()).toBe('3 weeks over');
  });
});

describe('the stage breakdown', () => {
  it('shows every stage, so a rising chalimus is visible before it matters', async () => {
    const wrapper = await panel(
      penView({ sample: [{ chalimus: 4, preAdult: 2, adultMale: 1, adultFemale: 1, caligus: 3 }] }),
    );
    const text = wrapper.find('.stages').text();
    expect(text).toContain('Chalimus');
    expect(text).toContain('4.00');
    expect(text).toContain('Caligus');
  });

  it('averages over the sample rather than showing a total', async () => {
    const wrapper = await panel(penView({ sample: evenSample(0.5, 20) }));
    expect(wrapper.find('.stages').text()).toContain('0.50');
  });
});

describe('the sample line', () => {
  it('says how many fish were examined', async () => {
    const wrapper = await panel(penView({ sample: evenSample(0.2, 24) }));
    expect(wrapper.find('.sample').text()).toContain('24 fish examined');
  });

  it('warns when the load sits on a handful of fish', async () => {
    const wrapper = await panel(penView({ sample: clusteredSample(6, 20) }));
    expect(wrapper.find('.sample').text()).toContain('heavily clustered');
  });

  it('says so plainly when the lice are evenly spread', async () => {
    const wrapper = await panel(penView({ sample: evenSample(1, 20) }));
    expect(wrapper.find('.sample').text()).toContain('evenly spread');
  });

  it('carries the sea temperature the count was taken at', async () => {
    const wrapper = await panel(penView({ seaTemperatureC: 11.2 }));
    expect(wrapper.find('.sample').text()).toContain('11.2 C');
  });
});

describe('the obligation', () => {
  it('stays out of the way while nothing is required', async () => {
    expect((await panel()).find('.obligation').exists()).toBe(false);
  });

  it('gives the reason and the deadline when one is', async () => {
    const wrapper = await panel(penView({ obligation: true }));
    expect(wrapper.find('.obligation').text()).toContain('Over limit');
    expect(wrapper.find('.obligation').text()).toContain('within 7 days');
  });
});

describe('the record', () => {
  it('draws the chart once there is more than one count', async () => {
    const wrapper = await panel(
      penView({
        weekly: [
          { week: 12, adultFemale: 0.1 },
          { week: 13, adultFemale: 0.2 },
          { week: 14, adultFemale: 0.3 },
        ],
      }),
    );
    expect(wrapper.findAll('rect.bar')).toHaveLength(3);
  });

  it('says why there is no chart rather than drawing one bar', async () => {
    const wrapper = await panel(penView({ weekly: [{ week: 12, adultFemale: 0.1 }] }));
    expect(wrapper.find('.thin').text()).toContain('One count is not a record');
  });
});

describe('a pen nobody has counted', () => {
  it('says the auditor treats it as a breach, not a gap', async () => {
    const wrapper = await panel(penView({ adultFemale: null, countedAt: null }));
    expect(wrapper.find('.none').text()).toContain('No count has been filed');
    expect(wrapper.find('.none').text()).toContain('breach');
    expect(wrapper.find('.value').exists()).toBe(false);
  });
});

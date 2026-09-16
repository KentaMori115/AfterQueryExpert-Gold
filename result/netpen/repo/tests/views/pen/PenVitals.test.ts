import { describe, expect, it } from 'vitest';

import PenVitals from '@/views/pen/PenVitals.vue';

import { mountView } from '../../support/mount';
import { emptyPen, penView } from '../../support/penView';

async function vitals(view = penView()) {
  const { wrapper } = await mountView(PenVitals, { props: { view } });
  return wrapper;
}

function tile(wrapper: Awaited<ReturnType<typeof vitals>>, label: string) {
  return wrapper.findAll('.tile').find((node) => node.text().startsWith(label));
}

describe('the numbers', () => {
  it('shows biomass in tonnes with the head count under it', async () => {
    const wrapper = await vitals(penView({ count: 50_000, meanWeightG: 4_000 }));
    expect(tile(wrapper, 'Standing biomass')?.text()).toContain('200.0');
    expect(tile(wrapper, 'Standing biomass')?.text()).toContain('50,000 fish');
  });

  it('puts density against the limit rather than on its own', async () => {
    const wrapper = await vitals(penView({ densityKgM3: 12.5 }));
    expect(tile(wrapper, 'Density')?.text()).toContain('50 % of the 25 kg/m3 limit');
  });

  it('writes an em dash where nothing has been measured, never a zero', async () => {
    const wrapper = await vitals(emptyPen(2));
    expect(tile(wrapper, 'Degree days')?.text()).toContain('—');
    expect(tile(wrapper, 'Mean weight')?.text()).toContain('Nothing standing');
  });
});

describe('growth against budget', () => {
  it('reports the gap, signed, rather than only the coefficient', async () => {
    const wrapper = await vitals(penView({ realisedTgc: 3.12, budgetTgc: 2.9 }));
    const text = tile(wrapper, 'Growth')?.text() ?? '';
    expect(text).toContain('3.12');
    expect(text).toContain('Budget 2.90');
    expect(text).toContain('+0.22');
  });

  it('reads good when it is ahead and bad when it is well behind', async () => {
    const ahead = await vitals(penView({ realisedTgc: 3.1, budgetTgc: 2.9 }));
    expect(tile(ahead, 'Growth')?.classes()).toContain('good');

    const behind = await vitals(penView({ realisedTgc: 2.4, budgetTgc: 2.9 }));
    expect(tile(behind, 'Growth')?.classes()).toContain('bad');
  });

  it('treats a small shortfall as amber rather than red', async () => {
    const wrapper = await vitals(penView({ realisedTgc: 2.75, budgetTgc: 2.9 }));
    expect(tile(wrapper, 'Growth')?.classes()).toContain('caution');
  });

  it('says why it cannot show a figure when there is no record to fit', async () => {
    const wrapper = await vitals(penView({ realisedTgc: null }));
    expect(tile(wrapper, 'Growth')?.text()).toContain('Not enough record');
  });
});

describe('lice and oxygen', () => {
  it('puts the confidence interval under the count', async () => {
    const wrapper = await vitals(
      penView({ adultFemale: 0.34, interval: { lower: 0.21, upper: 0.47 } }),
    );
    expect(tile(wrapper, 'Lice')?.text()).toContain('95 % interval 0.21 to 0.47');
  });

  it('says nothing has been counted rather than showing an interval of nothing', async () => {
    const wrapper = await vitals(penView({ adultFemale: null }));
    expect(tile(wrapper, 'Lice')?.text()).toContain('Nothing counted');
  });

  it('shows the low of the day beside the latest reading, since that is what bit', async () => {
    expect(tile(await vitals(), 'Oxygen')?.text()).toContain('Low of 88 % in 24 h');
  });
});

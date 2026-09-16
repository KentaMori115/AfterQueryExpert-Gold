import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import BaseBadge from '@/ui/BaseBadge.vue';
import {
  toneForDensity,
  toneForFcr,
  toneForLice,
  toneForMortality,
  toneForOxygen,
  toneForSeverity,
  toneForUtilisation,
} from '@/ui/tones';

describe('rendering', () => {
  it('renders its slot', () => {
    const wrapper = mount(BaseBadge, { slots: { default: 'Over limit' } });
    expect(wrapper.text()).toBe('Over limit');
  });

  it('carries a title for the long form of a short label', () => {
    const wrapper = mount(BaseBadge, {
      props: { title: 'Over 0.5 adult female' },
      slots: { default: 'Over' },
    });
    expect(wrapper.attributes('title')).toBe('Over 0.5 adult female');
  });

  it('hides the dot from assistive technology', () => {
    const wrapper = mount(BaseBadge, { props: { dot: true }, slots: { default: 'Live' } });
    expect(wrapper.find('.dot').attributes('aria-hidden')).toBe('true');
  });

  it('omits the dot unless asked', () => {
    expect(
      mount(BaseBadge, { slots: { default: 'Live' } })
        .find('.dot')
        .exists(),
    ).toBe(false);
  });

  it('distinguishes solid from outlined', () => {
    const outlined = mount(BaseBadge, { props: { tone: 'bad' }, slots: { default: 'x' } });
    const solid = mount(BaseBadge, {
      props: { tone: 'bad', solid: true },
      slots: { default: 'x' },
    });
    expect(outlined.classes()).not.toContain('solid');
    expect(solid.classes()).toContain('solid');
  });

  it('carries the tone as a class', () => {
    expect(
      mount(BaseBadge, { props: { tone: 'caution' }, slots: { default: 'x' } }).classes(),
    ).toContain('caution');
  });
});

describe('tone mapping', () => {
  it('grades alert severity', () => {
    expect(toneForSeverity('urgent')).toBe('bad');
    expect(toneForSeverity('warning')).toBe('caution');
    expect(toneForSeverity('info')).toBe('info');
  });

  it('grades lice status', () => {
    expect(toneForLice('clear')).toBe('good');
    expect(toneForLice('approaching')).toBe('caution');
    expect(toneForLice('over-limit')).toBe('bad');
    expect(toneForLice('enforcement')).toBe('bad');
  });

  it('grades oxygen, with supersaturation a caution rather than a pass', () => {
    expect(toneForOxygen('good')).toBe('good');
    expect(toneForOxygen('reduced')).toBe('caution');
    expect(toneForOxygen('supersaturated')).toBe('caution');
    expect(toneForOxygen('low')).toBe('bad');
    expect(toneForOxygen('critical')).toBe('bad');
  });

  it('grades density and mortality', () => {
    expect(toneForDensity('comfortable')).toBe('good');
    expect(toneForDensity('over-limit')).toBe('bad');
    expect(toneForMortality('normal')).toBe('good');
    expect(toneForMortality('incident')).toBe('bad');
    expect(toneForMortality('unknown')).toBe('neutral');
  });

  it('grades feed conversion', () => {
    expect(toneForFcr('good')).toBe('good');
    expect(toneForFcr('poor')).toBe('bad');
    expect(toneForFcr('unknown')).toBe('neutral');
  });

  it('reads utilisation the other way round, where more is worse', () => {
    expect(toneForUtilisation(0.4)).toBe('good');
    expect(toneForUtilisation(0.9)).toBe('caution');
    expect(toneForUtilisation(1.1)).toBe('bad');
    expect(toneForUtilisation(Number.NaN)).toBe('neutral');
  });
});

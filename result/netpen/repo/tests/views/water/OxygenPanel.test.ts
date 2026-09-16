import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { OxygenReading } from '@/data/fixtures/environment';
import OxygenPanel from '@/views/water/OxygenPanel.vue';

const DAY_START = Date.UTC(2025, 2, 18, 6, 0);
const HOUR = 3_600_000;

function reading(hoursIn: number, saturationPercent: number): OxygenReading {
  return {
    penId: 'pen-3',
    at: DAY_START + hoursIn * HOUR,
    depthM: 5,
    temperatureC: 9.4,
    salinityPsu: 33.8,
    oxygenMgL: (saturationPercent / 100) * 9.6,
    saturationPercent,
  };
}

/** Falls through the afternoon and recovers, which is what a real day does. */
const DAY = [
  reading(0, 96),
  reading(3, 88),
  reading(6, 74),
  reading(9, 63),
  reading(12, 71),
  reading(14, 84),
];

function panel(readings: OxygenReading[] = DAY, loading = false) {
  return mount(OxygenPanel, { props: { readings, loading } });
}

describe('the headline', () => {
  it('leads with the low as well as the latest, since the low is what bit', () => {
    const wrapper = panel();
    const values = wrapper.findAll('.value').map((node) => node.text());
    expect(values).toEqual(['84 %', '63 %']);
  });

  it('says when the low happened', () => {
    const low = panel().findAll('.figure').at(1);
    expect(low?.find('.label').text()).toContain('at 15:00');
  });

  it('reads the band off the latest reading and names what to do about it', () => {
    const bad = panel([reading(0, 96), reading(3, 55)]);
    expect(bad.find('.badge').text()).toContain('Low, hold feed');
    expect(bad.find('.panel').classes()).toContain('alarm');
  });

  it('stays plain on a comfortable pen', () => {
    const wrapper = panel([reading(0, 94), reading(3, 92)]);
    expect(wrapper.find('.badge').text()).toBe('Comfortable');
    expect(wrapper.find('.panel').classes()).not.toContain('alarm');
  });

  it('sorts the readings however they arrive', () => {
    const wrapper = panel([reading(6, 70), reading(0, 96), reading(3, 88)]);
    expect(wrapper.findAll('.value')[0]?.text()).toBe('70 %');
  });
});

describe('the detail', () => {
  it('carries the probe reading as well as the derived percentage', () => {
    const text = panel().find('.detail').text();
    expect(text).toContain('mg/l');
    expect(text).toContain('33.8 PSU');
    expect(text).toContain('5 m');
  });
});

describe('time under the threshold', () => {
  it('adds up the hours where the ration has to come down', () => {
    // One reading sits under seventy, and it holds for the three hours until
    // the next one comes in above it.
    expect(panel().find('.below').text()).toContain('3.0 hours');
  });

  it('says nothing when the pen never went under', () => {
    const wrapper = panel([reading(0, 95), reading(3, 92)]);
    expect(wrapper.find('.below').exists()).toBe(false);
  });
});

describe('the trace', () => {
  it('draws the feeding thresholds on the chart rather than describing them', () => {
    const wrapper = panel();
    expect(wrapper.text()).toContain('Cut ration');
    expect(wrapper.text()).toContain('Hold feed');
  });

  it('labels the axis in clock time', () => {
    expect(panel().find('svg').text()).toMatch(/\d\d:\d\d/);
  });
});

describe('when there is nothing to show', () => {
  it('says the probe record is missing rather than drawing an empty chart', () => {
    const wrapper = panel([]);
    expect(wrapper.find('.waiting').text()).toContain('No oxygen has been logged');
    expect(wrapper.find('svg').exists()).toBe(false);
  });

  it('says it is fetching rather than saying there is nothing', () => {
    const wrapper = panel([], true);
    expect(wrapper.find('.waiting').text()).toContain('Fetching');
  });
});

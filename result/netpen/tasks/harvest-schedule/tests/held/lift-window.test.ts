import { describe, expect, it } from 'vitest';

import { planHarvest } from '@/domain/harvest/schedule';

/*
 * A salmon site in the spring of 2025, four pens on one generation, ten weeks
 * of boat slots and a temperature record that runs on past the last of them.
 * Nothing about a pen is stated: every count and every weight comes back out
 * of its own event log, which is why one changed event moves figures right
 * across the plan.
 */

const DAY = 86_400_000;
const AT = Date.parse('2025-03-03T00:00:00Z');

const temperatures = Array.from({ length: 300 }, (_, index) => ({
  at: AT - 120 * DAY + index * DAY,
  meanC: 6.5 + index * 0.02,
}));

const log = (groupId, entries) =>
  entries.map(([id, days, kind, countDelta, meanWeightG]) => ({
    id,
    groupId,
    at: AT + days * DAY,
    kind,
    countDelta,
    meanWeightG,
    note: '',
  }));

const dosed = (penId, method, days) => [
  {
    id: 'c1',
    method,
    completedAt: AT + days * DAY,
    penId,
    beforeCount: 1.4,
    afterCount: 0.3,
    note: 'bath',
  },
];

const P1 = {
  penId: 'P1',
  number: 1,
  tgc: 2.8,
  treatments: [],
  events: log('S24-P1', [
    ['e1', -500, 'stocked', 150_000, 118],
    ['e2', -60, 'mortality', -1_200, 3_100],
    ['e3', -21, 'weighed', 0, 4_050],
  ]),
};

const P2 = {
  penId: 'P2',
  number: 2,
  tgc: 2.9,
  treatments: dosed('P2', 'emamectin-benzoate', -6),
  events: log('S24-P2', [
    ['f1', -500, 'stocked', 155_000, 116],
    ['f2', -40, 'mortality', -3_000, 3_400],
    ['f3', -14, 'weighed', 0, 3_780],
  ]),
};

const P3 = {
  penId: 'P3',
  number: 3,
  tgc: 3.05,
  treatments: [],
  events: log('S24-P3', [
    ['g1', -500, 'stocked', 158_000, 120],
    ['g2', -30, 'mortality', -2_000, 2_900],
    ['g3', -14, 'weighed', 0, 3_150],
  ]),
};

const P4 = {
  penId: 'P4',
  number: 4,
  tgc: 3.15,
  treatments: [],
  events: log('S24-P4', [
    ['h1', -500, 'stocked', 164_000, 121],
    ['h2', -25, 'mortality', -3_000, 2_500],
    ['h3', -7, 'weighed', 0, 2_640],
  ]),
};

/* A mortality entered with the sign the wrong way round. */
const MISKEYED = {
  penId: 'P5',
  number: 5,
  tgc: 3.0,
  treatments: [],
  events: log('S24-P5', [
    ['k1', -500, 'stocked', 120_000, 119],
    ['k2', -30, 'mortality', 900, 3_000],
    ['k3', -14, 'weighed', 0, 3_900],
  ]),
};

const boat = (tonnes) => Array.from({ length: 10 }, () => tonnes);

const ask = (over = {}) => ({
  at: AT,
  maxBiomassT: 2_450,
  weeklyCapacityT: boat(700),
  minHarvestWeightG: 3_500,
  temperatures,
  pens: [P1, P2, P3, P4],
  ...over,
});

describe('a site growing into its ceiling', () => {
  const plan = planHarvest(ask());

  it('sends pen one away on the first boat of the plan', () => {
    expect(plan.bookings.map((booking) => booking.penId)).toEqual(['P1']);
    expect(plan.bookings[0].week).toBe(0);
  });

  it('lifts 683.84 t of it, at 4595.7 g a fish', () => {
    expect(plan.bookings[0].tonnes).toBeCloseTo(683.8435, 3);
    expect(plan.bookings[0].meanWeightG).toBeCloseTo(4_595.7226, 3);
  });

  it('opens at 2332.59 t with all four pens standing', () => {
    expect(plan.weeklyBiomassT[0]).toBeCloseTo(2_332.5879, 3);
  });

  it('loses that pen from the week after, not from the week it went', () => {
    expect(plan.weeklyBiomassT[1]).toBeCloseTo(1_712.0698, 3);
    expect(plan.weeklyBiomassT[2]).toBeCloseTo(1_778.0196, 3);
  });

  it('carries the rest to 2321.74 t by the last week', () => {
    expect(plan.weeklyBiomassT[9]).toBeCloseTo(2_321.7392, 3);
    expect(plan.weeklyBiomassT).toHaveLength(10);
  });

  it('never goes over 2450 t, and never empties the site either', () => {
    for (const biomass of plan.weeklyBiomassT) {
      expect(biomass).toBeLessThanOrEqual(2_450);
      expect(biomass).toBeGreaterThan(1_700);
    }
  });

  it('leaves nothing outstanding and nobody out', () => {
    expect(plan.shortfall).toBeNull();
    expect(plan.skipped).toEqual([]);
  });
});

describe('a licence nothing gets near', () => {
  const plan = planHarvest(ask({ maxBiomassT: 9_000 }));

  it('leaves every pen where it is', () => {
    expect(plan.bookings).toEqual([]);
    expect(plan.shortfall).toBeNull();
  });

  it('follows the site from 2332.59 t up to 3238.14 t', () => {
    expect(plan.weeklyBiomassT[0]).toBeCloseTo(2_332.5879, 3);
    expect(plan.weeklyBiomassT[9]).toBeCloseTo(3_238.1356, 3);
  });

  it('has it at 2507.18 t by the third week', () => {
    expect(plan.weeklyBiomassT[2]).toBeCloseTo(2_507.1847, 3);
  });
});

describe('a site already over today', () => {
  const plan = planHarvest(ask({ maxBiomassT: 2_300 }));

  it('names week zero and 32.59 t rather than a plan', () => {
    expect(plan.shortfall.week).toBe(0);
    expect(plan.shortfall.excessT).toBeCloseTo(32.5879, 3);
    expect(plan.bookings).toEqual([]);
  });
});

describe('what the boat will carry', () => {
  const slot = (week, tonnes) => boat(700).map((load, index) => (index === week ? tonnes : load));

  it('takes a pen that fills the slot to the tonne', () => {
    const plan = planHarvest(ask({ weeklyCapacityT: slot(1, 706.08899791729) }));
    expect(plan.bookings[0].week).toBe(1);
    expect(plan.bookings[0].tonnes).toBeCloseTo(706.089, 3);
  });

  it('sends it a week early when the slot is a hundredth short', () => {
    const plan = planHarvest(ask({ weeklyCapacityT: slot(1, 706.08) }));
    expect(plan.bookings[0].week).toBe(0);
    expect(plan.bookings[0].tonnes).toBeCloseTo(683.8435, 3);
  });

  it('lets it wait a week where the boat is bigger all round', () => {
    const plan = planHarvest(ask({ weeklyCapacityT: boat(710) }));
    expect(plan.bookings[0].week).toBe(1);
    expect(plan.bookings[0].meanWeightG).toBeCloseTo(4_745.2218, 3);
  });

  it('leaves the site heavier in week one for the week it waited', () => {
    const waited = planHarvest(ask({ weeklyCapacityT: boat(710) }));
    const early = planHarvest(ask());
    expect(waited.weeklyBiomassT[1]).toBeCloseTo(2_418.1588, 3);
    expect(early.weeklyBiomassT[1]).toBeCloseTo(1_712.0698, 3);
  });
});

describe('a medicine still in the fish', () => {
  const three = (pen) => ({ pens: [pen, P3, P4], maxBiomassT: 1_700 });

  it('passes over the pen it is in and takes the one behind', () => {
    const plan = planHarvest(ask(three(P2)));
    expect(plan.bookings.map((booking) => booking.penId)).toEqual(['P3']);
    expect(plan.bookings[0].tonnes).toBeCloseTo(550.4296, 3);
  });

  it('takes that pen itself once the treatment is five weeks back', () => {
    const cleared = { ...P2, treatments: dosed('P2', 'emamectin-benzoate', -40) };
    const plan = planHarvest(ask(three(cleared)));
    expect(plan.bookings.map((booking) => booking.penId)).toEqual(['P2']);
    expect(plan.bookings[0].tonnes).toBeCloseTo(636.0684, 3);
    expect(plan.bookings[0].meanWeightG).toBeCloseTo(4_184.6605, 3);
  });

  it('never holds a pen for thermal delousing on the same day', () => {
    const thermal = { ...P2, treatments: dosed('P2', 'thermal', -6) };
    const plan = planHarvest(ask(three(thermal)));
    expect(plan.bookings.map((booking) => booking.penId)).toEqual(['P2']);
    expect(plan.bookings[0].week).toBe(0);
  });

  it('shows in what the site is left carrying', () => {
    const held = planHarvest(ask(three(P2)));
    const cleared = planHarvest(ask(three({ ...P2, treatments: dosed('P2', 'thermal', -6) })));
    expect(held.weeklyBiomassT[1]).toBeCloseTo(1_140.2967, 3);
    expect(cleared.weeklyBiomassT[1]).toBeCloseTo(1_053.875, 3);
  });
});

describe('fish under the contract weight', () => {
  const pair = { pens: [P3, P4], maxBiomassT: 1_060 };

  it('lets pen three go in week one against a 3600 g floor', () => {
    const plan = planHarvest(ask({ ...pair, minHarvestWeightG: 3_600 }));
    expect(plan.bookings[0].penId).toBe('P3');
    expect(plan.bookings[0].week).toBe(1);
    expect(plan.bookings[0].meanWeightG).toBeCloseTo(3_665.2126, 3);
  });

  it('leaves nobody to ask against a 3700 g one', () => {
    const plan = planHarvest(ask({ ...pair, minHarvestWeightG: 3_700 }));
    expect(plan.bookings).toEqual([]);
    expect(plan.shortfall.week).toBe(2);
    expect(plan.shortfall.excessT).toBeCloseTo(36.8389, 3);
  });

  it('walks away there rather than booking a week further out', () => {
    const plan = planHarvest(ask({ ...pair, minHarvestWeightG: 3_700 }));
    expect(plan.weeklyBiomassT[9]).toBeCloseTo(1_452.9591, 3);
    expect(plan.bookings).toHaveLength(0);
  });
});

describe('a site sitting exactly on its licence', () => {
  /* No temperature record at all, so the ledger holds the weighed figure and
     the site stands at 1000 t to the gram, week after week. */
  const flat = (maxBiomassT) => ({
    at: AT,
    maxBiomassT,
    weeklyCapacityT: [2_000, 2_000, 2_000],
    minHarvestWeightG: 3_000,
    temperatures: [],
    pens: [
      {
        penId: 'PE',
        number: 1,
        tgc: 3,
        treatments: [],
        events: log('S24-PE', [['p1', -400, 'stocked', 125_000, 8_000]]),
      },
    ],
  });

  it('carries 1000 t through a horizon with no heat in it', () => {
    expect(planHarvest(flat(1_000)).weeklyBiomassT).toEqual([1_000, 1_000, 1_000]);
  });

  it('is not over a limit it is level with', () => {
    const plan = planHarvest(flat(1_000));
    expect(plan.bookings).toEqual([]);
    expect(plan.shortfall).toBeNull();
  });

  it('is over one a tenth of a tonne under it', () => {
    const plan = planHarvest(flat(999.9));
    expect(plan.shortfall.week).toBe(0);
    expect(plan.shortfall.excessT).toBeCloseTo(0.1, 6);
    expect(plan.bookings).toEqual([]);
  });
});

describe('a log that will not add up', () => {
  const plan = planHarvest(ask({ pens: [P1, P2, P3, P4, MISKEYED] }));

  it('names the pen rather than guessing at it', () => {
    expect(plan.skipped).toEqual(['P5']);
  });

  it('keeps its biomass out of the licence entirely', () => {
    expect(plan.weeklyBiomassT[0]).toBeCloseTo(2_332.5879, 3);
    expect(plan.weeklyBiomassT[9]).toBeCloseTo(2_321.7392, 3);
  });

  it('plans the rest exactly as if it were not there', () => {
    expect(plan.bookings.map((booking) => booking.penId)).toEqual(['P1']);
    expect(plan.bookings[0].tonnes).toBeCloseTo(683.8435, 3);
    expect(plan.shortfall).toBeNull();
  });

  it('lists two of them lowest grid number first', () => {
    const nostock = {
      penId: 'PZ',
      number: 2,
      tgc: 3.0,
      treatments: [],
      events: log('S24-PZ', [['z1', -30, 'mortality', -500, 3_000]]),
    };
    const plan = planHarvest(ask({ pens: [MISKEYED, nostock, P3] }));
    expect(plan.skipped).toEqual(['PZ', 'P5']);
    expect(plan.bookings).toEqual([]);
  });

  it('has nothing to say about a site of nothing but bad logs', () => {
    const nothing = planHarvest(ask({ pens: [MISKEYED] }));
    expect(nothing.weeklyBiomassT).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(nothing.bookings).toEqual([]);
    expect(nothing.shortfall).toBeNull();
    expect(nothing.skipped).toEqual(['P5']);
  });
});

describe('events dated inside the horizon', () => {
  const later = {
    penId: 'P6',
    number: 6,
    tgc: 3.05,
    treatments: [],
    events: log('S24-P6', [
      ['m1', -500, 'stocked', 158_000, 120],
      ['m2', -14, 'weighed', 0, 3_150],
      ['m3', 21, 'mortality', -40_000, 3_900],
    ]),
  };
  const reweighed = {
    penId: 'P7',
    number: 7,
    tgc: 3.05,
    treatments: [],
    events: log('S24-P7', [
      ['n1', -500, 'stocked', 158_000, 120],
      ['n2', -14, 'weighed', 0, 3_150],
      ['n3', 28, 'weighed', 0, 4_600],
    ]),
  };

  it('leaves a mortality dated three weeks out where it belongs', () => {
    const plan = planHarvest(ask({ pens: [later], maxBiomassT: 9_000 }));
    expect(plan.weeklyBiomassT[0]).toBeCloseTo(557.4864, 3);
    expect(plan.weeklyBiomassT[1]).toBeCloseTo(579.1036, 3);
  });

  it('and takes it off from the week it falls in', () => {
    const plan = planHarvest(ask({ pens: [later], maxBiomassT: 9_000 }));
    expect(plan.weeklyBiomassT[2]).toBeCloseTo(449.3096, 3);
    expect(plan.weeklyBiomassT[9]).toBeCloseTo(587.9635, 3);
  });

  it('lets a weighing further out reset what the pen grows from', () => {
    const plan = planHarvest(ask({ pens: [reweighed], maxBiomassT: 9_000 }));
    expect(plan.weeklyBiomassT[2]).toBeCloseTo(601.6179, 3);
    expect(plan.weeklyBiomassT[3]).toBeCloseTo(726.8, 3);
    expect(plan.weeklyBiomassT[9]).toBeCloseTo(905.4824, 3);
  });
});

describe('two pens wanting the same week', () => {
  const handful = {
    penId: 'P8',
    number: 8,
    tgc: 2.7,
    treatments: [],
    events: log('S24-P8', [
      ['q1', -500, 'stocked', 6_200, 120],
      ['q2', -14, 'weighed', 0, 5_100],
    ]),
  };
  const plan = planHarvest(ask({ pens: [P3, P4, handful], maxBiomassT: 1_090 }));

  it('asks the biggest fish first, out of a pen worth 35 t', () => {
    const small = plan.bookings.find((booking) => booking.penId === 'P8');
    expect(small.week).toBe(1);
    expect(small.tonnes).toBeCloseTo(35.4703, 3);
    expect(small.meanWeightG).toBeCloseTo(5_721.0192, 3);
  });

  it('drops the pen behind it to week zero, week one being spoken for', () => {
    const large = plan.bookings.find((booking) => booking.penId === 'P3');
    expect(large.week).toBe(0);
    expect(large.tonnes).toBeCloseTo(550.4296, 3);
  });

  it('hands them back earliest week first, whatever order they were booked', () => {
    expect(plan.bookings.map((booking) => booking.penId)).toEqual(['P3', 'P8']);
  });

  it('leaves the site at 502.84 t once both are gone', () => {
    expect(plan.weeklyBiomassT[2]).toBeCloseTo(502.8364, 3);
    expect(plan.shortfall).toBeNull();
  });
});

describe('pens with nothing between them', () => {
  const twin = (penId, number) => ({
    penId,
    number,
    tgc: 3.0,
    treatments: [],
    events: log(`S24-${penId}`, [
      [`${penId}1`, -500, 'stocked', 150_000, 120],
      [`${penId}2`, -14, 'weighed', 0, 4_000],
    ]),
  });

  it('goes down the grid, pen one before pen nine', () => {
    const plan = planHarvest(ask({ pens: [twin('PB', 9), twin('PA', 1)], maxBiomassT: 1_420 }));
    expect(plan.bookings).toHaveLength(1);
    expect(plan.bookings[0].penId).toBe('PA');
    expect(plan.bookings[0].tonnes).toBeCloseTo(688.7232, 3);
  });
});

describe('a pen that overtakes the one in front', () => {
  const slow = {
    penId: 'PC',
    number: 1,
    tgc: 1.5,
    treatments: [],
    events: log('S24-PC', [
      ['c1', -500, 'stocked', 140_000, 120],
      ['c2', -14, 'weighed', 0, 4_150],
    ]),
  };
  const fast = {
    penId: 'PD',
    number: 2,
    tgc: 4.3,
    treatments: [],
    events: log('S24-PD', [
      ['d1', -500, 'stocked', 140_000, 120],
      ['d2', -14, 'weighed', 0, 3_950],
    ]),
  };
  const plan = planHarvest(ask({ pens: [slow, fast], maxBiomassT: 1_340 }));

  it('takes the pen that is behind today', () => {
    expect(plan.bookings).toHaveLength(1);
    expect(plan.bookings[0].penId).toBe('PD');
  });

  it('at 4807.94 g, which is what it made of the weeks between', () => {
    expect(plan.bookings[0].meanWeightG).toBeCloseTo(4_807.9382, 3);
    expect(plan.bookings[0].tonnes).toBeCloseTo(673.1114, 3);
  });

  it('and leaves the slower one standing at 633.53 t', () => {
    expect(plan.weeklyBiomassT[2]).toBeCloseTo(633.529, 3);
  });
});

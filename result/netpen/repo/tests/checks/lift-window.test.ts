import { describe, expect, it } from 'vitest';

import { planHarvest } from '@/domain/harvest/schedule';

/*
 * A salmon site in the spring of 2025, four pens on one generation, ten weeks
 * of boat slots and a temperature record that runs on past the last of them.
 * Nothing about a pen is stated: every count and every weight comes back out
 * of its own event log, and the same pen reads as three different figures
 * depending on who is asking, which is what most of these cases are about.
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
  conditionFactor: 1.2,
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
  conditionFactor: 1.35,
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
  conditionFactor: 1.05,
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
  conditionFactor: 1.55,
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
  conditionFactor: 1.2,
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
  weeklyCapacityT: boat(600),
  minHarvestWeightG: 3_000,
  temperatures,
  pens: [P1, P2, P3, P4],
  ...over,
});

describe('a site growing into its ceiling', () => {
  const plan = planHarvest(ask());

  it('empties one pen, and not the one with the biggest fish in it', () => {
    expect(plan.bookings).toHaveLength(1);
    expect(plan.bookings[0].penId).toBe('P2');
    expect(plan.bookings[0].week).toBe(1);
  });

  it('lifts 658.19 t of it, which the boat lands as 561.11 t', () => {
    expect(plan.bookings[0].tonnes).toBeCloseTo(658.1948, 3);
    expect(plan.bookings[0].guttedT).toBeCloseTo(561.1111, 3);
    expect(plan.bookings[0].meanWeightG).toBeCloseTo(4_330.2292, 3);
  });

  it('opens at 2332.59 t with all four pens standing', () => {
    expect(plan.weeklyBiomassT[0]).toBeCloseTo(2_332.5879, 3);
    expect(plan.weeklyBiomassT).toHaveLength(10);
  });

  it('loses that pen from the week after, not from the week it went', () => {
    expect(plan.weeklyBiomassT[1]).toBeCloseTo(2_418.1588, 3);
    expect(plan.weeklyBiomassT[2]).toBeCloseTo(1_826.004, 3);
  });

  it('carries the rest to 2369.36 t by the last week', () => {
    expect(plan.weeklyBiomassT[9]).toBeCloseTo(2_369.3555, 3);
  });

  it('never goes over 2450 t, and never empties the site either', () => {
    expect(plan.weeklyBiomassT).toHaveLength(10);
    for (const biomass of plan.weeklyBiomassT) {
      expect(biomass).toBeLessThanOrEqual(2_450);
      expect(biomass).toBeGreaterThan(1_800);
    }
  });

  it('leaves nothing outstanding and nobody out', () => {
    expect(plan.shortfall).toBeNull();
    expect(plan.skipped).toEqual([]);
  });
});

describe('a licence nothing gets near', () => {
  const plan = planHarvest(ask({ maxBiomassT: 9_000 }));

  it('books no boat at all', () => {
    expect(plan.bookings).toEqual([]);
    expect(plan.shortfall).toBeNull();
  });

  it('and still says what the site will be carrying', () => {
    expect(plan.weeklyBiomassT[0]).toBeCloseTo(2_332.5879, 3);
    expect(plan.weeklyBiomassT[9]).toBeCloseTo(3_238.1356, 3);
  });
});

describe('a site already over today', () => {
  const plan = planHarvest(ask({ maxBiomassT: 2_300 }));

  it('names week zero and the 32.59 t it is over by', () => {
    expect(plan.shortfall.week).toBe(0);
    expect(plan.shortfall.excessT).toBeCloseTo(32.5879, 3);
  });

  it('books nothing rather than a plan that still breaches', () => {
    expect(plan.bookings).toEqual([]);
    expect(plan.weeklyBiomassT[0]).toBeCloseTo(2_332.5879, 3);
  });
});

describe('what the boat lands', () => {
  it('takes the pen the slot has room for, which is not the heaviest one', () => {
    const plan = planHarvest(ask());
    expect(plan.bookings.map((booking) => booking.penId)).toEqual(['P2']);
    expect(plan.bookings[0].guttedT).toBeCloseTo(561.1111, 3);
  });

  it('reaches pen one on a 700 t slot, though it stands at 706.09 t', () => {
    const plan = planHarvest(ask({ weeklyCapacityT: boat(700) }));
    expect(plan.bookings.map((booking) => booking.penId)).toEqual(['P1']);
    expect(plan.bookings[0].tonnes).toBeCloseTo(706.089, 3);
    expect(plan.bookings[0].guttedT).toBeCloseTo(607.2365, 3);
  });

  it('leaves the site 48 t lighter for having taken the heavier pen', () => {
    const bigger = planHarvest(ask({ weeklyCapacityT: boat(700) }));
    const smaller = planHarvest(ask());
    expect(bigger.weeklyBiomassT[2]).toBeCloseTo(1_778.0196, 3);
    expect(smaller.weeklyBiomassT[2]).toBeCloseTo(1_826.004, 3);
  });

  it('reports both figures for the pen it books', () => {
    const plan = planHarvest(ask({ weeklyCapacityT: boat(700) }));
    expect(plan.bookings[0].guttedT).toBeLessThan(plan.bookings[0].tonnes);
    expect(plan.weeklyBiomassT[9]).toBeCloseTo(2_321.7392, 3);
  });
});

describe('the weight a contract reads', () => {
  /* Pen two stands at a live mean of 4184.66 g in week zero and grades out at
     3567.12. The licence breaks in week one and only pen two can cover it. */
  const clean = { ...P2, treatments: [] };
  const site = (minHarvestWeightG) =>
    ask({ pens: [clean, P3], maxBiomassT: 1_200, minHarvestWeightG });

  it('sends pen two against a 3500 g floor', () => {
    const plan = planHarvest(site(3_500));
    expect(plan.bookings.map((booking) => booking.penId)).toEqual(['P2']);
    expect(plan.bookings[0].week).toBe(0);
    expect(plan.bookings[0].tonnes).toBeCloseTo(636.0684, 3);
  });

  it('and drops the site to 571.77 t the week after', () => {
    const plan = planHarvest(site(3_500));
    expect(plan.weeklyBiomassT[0]).toBeCloseTo(1_186.498, 3);
    expect(plan.weeklyBiomassT[1]).toBeCloseTo(571.7732, 3);
  });

  it('refuses it against 3600 g, a hundred grams over what it grades', () => {
    const plan = planHarvest(site(3_600));
    expect(plan.bookings).toEqual([]);
    expect(plan.shortfall.week).toBe(1);
    expect(plan.shortfall.excessT).toBeCloseTo(29.968, 3);
  });

  it('and still refuses it at 4100 g, under the live mean it carries', () => {
    const plan = planHarvest(site(4_100));
    expect(plan.bookings).toEqual([]);
    expect(plan.shortfall.week).toBe(1);
  });

  it('leaving the whole site standing in every week', () => {
    const plan = planHarvest(site(3_600));
    expect(plan.weeklyBiomassT[1]).toBeCloseTo(1_229.968, 3);
    expect(plan.weeklyBiomassT[9]).toBeCloseTo(1_646.0877, 3);
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
    expect(plan.bookings[0].guttedT).toBeCloseTo(542.2483, 3);
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

describe('a withdrawal that clears on the day', () => {
  /* Five degrees every day of the record, so the heat behind a treatment is
     the days behind it times five, and teflubenzuron's 105 degree-days land
     exactly three weeks back. Both pens carry the same fish at the same
     condition, which leaves the withdrawal as the only thing between them. */
  const warm = Array.from({ length: 400 }, (_, index) => ({
    at: AT - 200 * DAY + index * DAY,
    meanC: 5,
  }));
  const treated = (days) => ({
    penId: 'PT',
    number: 1,
    tgc: 3,
    conditionFactor: 1.2,
    treatments: dosed('PT', 'teflubenzuron', days),
    events: log('S24-PT', [['t1', -400, 'stocked', 100_000, 4_000]]),
  });
  const untreated = {
    penId: 'PU',
    number: 2,
    tgc: 3,
    conditionFactor: 1.2,
    treatments: [],
    events: log('S24-PU', [['u1', -400, 'stocked', 100_000, 4_000]]),
  };
  const site = (days) => ({
    at: AT,
    maxBiomassT: 1_380,
    weeklyCapacityT: [2_000, 2_000, 2_000],
    minHarvestWeightG: 3_500,
    temperatures: warm,
    pens: [treated(days), untreated],
  });

  it('holds a pen with a hundred degree-days behind the dose', () => {
    const plan = planHarvest(site(-13));
    expect(plan.bookings.map((booking) => booking.penId)).toEqual(['PU']);
    expect(plan.bookings[0].week).toBe(0);
  });

  it('lets it go a day earlier, on a hundred and five to the degree-day', () => {
    const plan = planHarvest(site(-14));
    expect(plan.bookings.map((booking) => booking.penId)).toEqual(['PT']);
    expect(plan.bookings[0].week).toBe(0);
  });

  it('and the two pens weigh the same, so nothing else could have decided it', () => {
    const held = planHarvest(site(-13));
    const cleared = planHarvest(site(-14));
    expect(held.bookings[0].tonnes).toBeCloseTo(683.6293, 3);
    expect(cleared.bookings[0].tonnes).toBeCloseTo(683.6293, 3);
    expect(held.bookings[0].guttedT).toBeCloseTo(587.9212, 3);
    expect(cleared.weeklyBiomassT).toEqual(held.weeklyBiomassT);
  });
});

describe('fish under the contract weight', () => {
  const pair = { pens: [P3, P4], maxBiomassT: 1_060 };

  it('lets pen three go in week one against a 3100 g floor', () => {
    const plan = planHarvest(ask({ ...pair, minHarvestWeightG: 3_100 }));
    expect(plan.bookings[0].penId).toBe('P3');
    expect(plan.bookings[0].week).toBe(1);
    expect(plan.bookings[0].meanWeightG).toBeCloseTo(3_665.2126, 3);
  });

  it('leaves nobody to ask against a 3300 g one', () => {
    const plan = planHarvest(ask({ ...pair, minHarvestWeightG: 3_300 }));
    expect(plan.bookings).toEqual([]);
    expect(plan.shortfall.week).toBe(2);
    expect(plan.shortfall.excessT).toBeCloseTo(36.8389, 3);
  });

  it('walks away there rather than booking a week further out', () => {
    const plan = planHarvest(ask({ ...pair, minHarvestWeightG: 3_300 }));
    expect(plan.weeklyBiomassT[9]).toBeCloseTo(1_452.9591, 3);
    expect(plan.bookings).toHaveLength(0);
  });
});

describe('a pen weighed at the contract floor', () => {
  /* No temperature record, so the ledger hands back the weighed figure to the
     gram: five kilos live, and at a condition factor of 1.2 exactly 4.3 kg on
     the hook. Pen B takes another forty thousand fish ten days in, which is
     what puts the site over. */
  const flat = (over = {}) => ({
    at: AT,
    maxBiomassT: 999.9,
    weeklyCapacityT: [2_000, 2_000, 2_000],
    minHarvestWeightG: 4_300,
    temperatures: [],
    pens: [
      {
        penId: 'PA',
        number: 1,
        tgc: 3,
        conditionFactor: 1.2,
        treatments: [],
        events: log('S24-PA', [['a1', -400, 'stocked', 100_000, 5_000]]),
      },
      {
        penId: 'PB',
        number: 2,
        tgc: 3,
        conditionFactor: 1.2,
        treatments: [],
        events: log('S24-PB', [
          ['b1', -400, 'stocked', 60_000, 5_000],
          ['b2', 10, 'stocked', 40_000, 5_000],
        ]),
      },
      {
        penId: 'PC',
        number: 3,
        tgc: 3,
        conditionFactor: 1.2,
        treatments: [],
        events: log('S24-PC', [
          ['c1', -400, 'stocked', 20_000, 5_000],
          ['c2', -30, 'mortality', 100, 5_000],
        ]),
      },
    ],
    ...over,
  });

  it('takes a pen sitting on the floor rather than above it', () => {
    const plan = planHarvest(flat());
    expect(plan.bookings).toEqual([
      { penId: 'PA', week: 0, tonnes: 500, guttedT: 430, meanWeightG: 5_000 },
    ]);
  });

  it('and finds nobody at all with the floor a gram higher', () => {
    const plan = planHarvest(flat({ minHarvestWeightG: 4_301 }));
    expect(plan.bookings).toEqual([]);
    expect(plan.shortfall.week).toBe(1);
    expect(plan.shortfall.excessT).toBeCloseTo(0.1, 6);
  });

  it('leaves the hundred tonnes in the pen that will not add up out of both', () => {
    expect(planHarvest(flat()).weeklyBiomassT).toEqual([800, 500, 500]);
    expect(planHarvest(flat({ minHarvestWeightG: 4_301 })).weeklyBiomassT).toEqual([
      800, 1_000, 1_000,
    ]);
  });

  it('naming it instead', () => {
    expect(planHarvest(flat()).skipped).toEqual(['PC']);
  });

  it('goes on a slot the size of what it lands, to the tonne', () => {
    const plan = planHarvest(flat({ weeklyCapacityT: [430, 2_000, 2_000] }));
    expect(plan.bookings.map((booking) => booking.penId)).toEqual(['PA']);
    expect(plan.bookings[0].guttedT).toBe(430);
  });

  it('and falls to the smaller pen on a slot a hundredth under', () => {
    const plan = planHarvest(flat({ weeklyCapacityT: [429.99, 2_000, 2_000] }));
    expect(plan.bookings).toEqual([
      { penId: 'PB', week: 0, tonnes: 300, guttedT: 258, meanWeightG: 5_000 },
    ]);
  });
});

describe('a site sitting exactly on its licence', () => {
  const level = (maxBiomassT) => ({
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
        conditionFactor: 1.2,
        treatments: [],
        events: log('S24-PE', [['p1', -400, 'stocked', 125_000, 8_000]]),
      },
    ],
  });

  it('carries 1000 t through a horizon with no heat in it', () => {
    expect(planHarvest(level(1_000)).weeklyBiomassT).toEqual([1_000, 1_000, 1_000]);
  });

  it('is not over a limit it is level with', () => {
    const plan = planHarvest(level(1_000));
    expect(plan.bookings).toEqual([]);
    expect(plan.shortfall).toBeNull();
  });

  it('is over one a tenth of a tonne under it', () => {
    const plan = planHarvest(level(999.9));
    expect(plan.shortfall.week).toBe(0);
    expect(plan.shortfall.excessT).toBeCloseTo(0.1, 6);
    expect(plan.bookings).toEqual([]);
  });
});

describe('a log that will not add up', () => {
  const plan = planHarvest(ask({ pens: [P1, P2, P3, P4, MISKEYED] }));

  it('names the pen and leaves it out of the plan', () => {
    expect(plan.skipped).toEqual(['P5']);
    expect(plan.bookings.map((booking) => booking.penId)).toEqual(['P2']);
  });

  it('keeps its 468 t out of the licence total as well', () => {
    expect(plan.weeklyBiomassT[0]).toBeCloseTo(2_332.5879, 3);
    expect(plan.weeklyBiomassT[2]).toBeCloseTo(1_826.004, 3);
  });

  it('goes down the grid when more than one will not add up', () => {
    const nostock = {
      penId: 'PZ',
      number: 2,
      tgc: 3.0,
      conditionFactor: 1.2,
      treatments: [],
      events: log('S24-PZ', [['z1', -30, 'mortality', -500, 3_000]]),
    };
    const plan = planHarvest(ask({ pens: [MISKEYED, nostock, P3] }));
    expect(plan.skipped).toEqual(['PZ', 'P5']);
  });

  it('and carries only the pen that does add up', () => {
    const nostock = {
      penId: 'PZ',
      number: 2,
      tgc: 3.0,
      conditionFactor: 1.2,
      treatments: [],
      events: log('S24-PZ', [['z1', -30, 'mortality', -500, 3_000]]),
    };
    const plan = planHarvest(ask({ pens: [MISKEYED, nostock, P3] }));
    expect(plan.weeklyBiomassT[0]).toBeCloseTo(550.4296, 3);
    expect(plan.bookings).toEqual([]);
  });

  it('reads a site of nothing but bad logs as empty', () => {
    const nothing = planHarvest(ask({ pens: [MISKEYED] }));
    expect(nothing.weeklyBiomassT).toEqual(Array.from({ length: 10 }, () => 0));
    expect(nothing.skipped).toEqual(['P5']);
  });
});

describe('events dated inside the horizon', () => {
  const later = {
    penId: 'P6',
    number: 6,
    tgc: 3.05,
    conditionFactor: 1.05,
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
    conditionFactor: 1.05,
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

describe('one pen where the obvious pick takes two', () => {
  const handful = {
    penId: 'P8',
    number: 8,
    tgc: 2.7,
    conditionFactor: 0.9,
    treatments: [],
    events: log('S24-P8', [
      ['q1', -500, 'stocked', 6_200, 120],
      ['q2', -14, 'weighed', 0, 5_100],
    ]),
  };
  const pens = [P3, P4, handful];
  const plan = planHarvest(ask({ pens, maxBiomassT: 1_090 }));

  it('empties one pen where taking the small one as well would also clear it', () => {
    expect(plan.bookings).toHaveLength(1);
    expect(plan.bookings[0].penId).toBe('P3');
  });

  it('and waits until week one, the last week that still holds', () => {
    expect(plan.bookings[0].week).toBe(1);
  });

  it('lifting 571.77 t, which the boat lands as 496.01 t', () => {
    expect(plan.bookings[0].tonnes).toBeCloseTo(571.7732, 3);
    expect(plan.bookings[0].guttedT).toBeCloseTo(496.0132, 3);
    expect(plan.bookings[0].meanWeightG).toBeCloseTo(3_665.2126, 3);
  });

  it('carries the whole site through week one, half a tonne under licence', () => {
    expect(plan.weeklyBiomassT[0]).toBeCloseTo(1_047.1329, 3);
    expect(plan.weeklyBiomassT[1]).toBeCloseTo(1_089.3453, 3);
  });

  it('and drops to 539.36 the week after, with nothing over', () => {
    expect(plan.weeklyBiomassT[2]).toBeCloseTo(539.3559, 3);
    expect(plan.shortfall).toBeNull();
  });

  it('forty tonnes off the licence and the same pen goes a week earlier', () => {
    const tighter = planHarvest(ask({ pens, maxBiomassT: 1_050 }));
    expect(tighter.bookings).toHaveLength(1);
    expect(tighter.bookings[0].penId).toBe('P3');
    expect(tighter.bookings[0].week).toBe(0);
  });

  it('for 550.43 t, leaving 517.57 in the water the week after', () => {
    const tighter = planHarvest(ask({ pens, maxBiomassT: 1_050 }));
    expect(tighter.bookings[0].tonnes).toBeCloseTo(550.4296, 3);
    expect(tighter.weeklyBiomassT[1]).toBeCloseTo(517.5722, 3);
  });
});

describe('pens with nothing between them', () => {
  const twin = (penId, number, conditionFactor) => ({
    penId,
    number,
    tgc: 3.0,
    conditionFactor,
    treatments: [],
    events: log(`S24-${penId}`, [
      [`${penId}1`, -500, 'stocked', 150_000, 120],
      [`${penId}2`, -14, 'weighed', 0, 4_000],
    ]),
  });

  it('goes down the grid, pen one before pen nine', () => {
    const plan = planHarvest(
      ask({ pens: [twin('PB', 9, 1.1), twin('PA', 1, 1.5)], maxBiomassT: 1_420 }),
    );
    expect(plan.bookings).toHaveLength(1);
    expect(plan.bookings[0].penId).toBe('PA');
    expect(plan.bookings[0].tonnes).toBeCloseTo(688.7232, 3);
  });

  it('even though the leaner pen would have been the lighter lift', () => {
    const plan = planHarvest(
      ask({ pens: [twin('PB', 9, 1.1), twin('PA', 1, 1.5)], maxBiomassT: 1_420 }),
    );
    expect(plan.bookings[0].guttedT).toBeCloseTo(581.9711, 3);
    expect(plan.weeklyBiomassT[2]).toBeCloseTo(713.1275, 3);
  });
});

describe('a week the boat shares', () => {
  /* Nothing grows, so every figure is exact. Two small pens are standing and a
     third arrives seventeen days in with seven hundred tonnes behind it, which
     is more than the licence will take on top of them. Both have to be gone by
     week two, and the only question is whether they can go together. */
  const pen = (penId, number, count, days) => ({
    penId,
    number,
    tgc: 3,
    conditionFactor: 1.2,
    treatments: [],
    events: log(`S24-${penId}`, [[`${penId}1`, days, 'stocked', count, 5_000]]),
  });
  const site = (weeklyCapacityT) => ({
    at: AT,
    maxBiomassT: 700,
    weeklyCapacityT,
    minHarvestWeightG: 4_300,
    temperatures: [],
    pens: [pen('PD', 1, 60_000, -400), pen('PE', 2, 50_000, -400), pen('PG', 3, 140_000, 17)],
  });

  it('puts both pens on the same boat when there is room for them', () => {
    const plan = planHarvest(site([2_000, 2_000, 2_000, 2_000]));
    expect(plan.bookings).toEqual([
      { penId: 'PD', week: 1, tonnes: 300, guttedT: 258, meanWeightG: 5_000 },
      { penId: 'PE', week: 1, tonnes: 250, guttedT: 215, meanWeightG: 5_000 },
    ]);
  });

  it('and holds them to week one, which is as late as they can go', () => {
    const plan = planHarvest(site([2_000, 2_000, 2_000, 2_000]));
    expect(plan.weeklyBiomassT).toEqual([550, 550, 700, 700]);
    expect(plan.shortfall).toBeNull();
  });

  it('fits them into a slot of exactly what the two of them land', () => {
    const plan = planHarvest(site([2_000, 473, 2_000, 2_000]));
    expect(plan.bookings.map((booking) => booking.penId)).toEqual(['PD', 'PE']);
    expect(plan.bookings.map((booking) => booking.week)).toEqual([1, 1]);
  });

  it('and splits them a hundredth under, the lower number keeping the week', () => {
    const plan = planHarvest(site([2_000, 472.99, 2_000, 2_000]));
    expect(plan.bookings).toEqual([
      { penId: 'PE', week: 0, tonnes: 250, guttedT: 215, meanWeightG: 5_000 },
      { penId: 'PD', week: 1, tonnes: 300, guttedT: 258, meanWeightG: 5_000 },
    ]);
  });

  it('which costs the site 250 t a week earlier than it wanted', () => {
    const plan = planHarvest(site([2_000, 472.99, 2_000, 2_000]));
    expect(plan.weeklyBiomassT).toEqual([550, 300, 700, 700]);
  });

  it('splits them the same way when the later week has room for one', () => {
    const plan = planHarvest(site([2_000, 258, 2_000, 2_000]));
    expect(plan.bookings.map((booking) => booking.penId)).toEqual(['PE', 'PD']);
    expect(plan.bookings.map((booking) => booking.week)).toEqual([0, 1]);
  });

  it('and books nothing at all where the earlier week will take neither', () => {
    const plan = planHarvest(site([214, 472.99, 2_000, 2_000]));
    expect(plan.bookings).toEqual([]);
    expect(plan.shortfall).toEqual({ week: 2, excessT: 550 });
    expect(plan.weeklyBiomassT).toEqual([550, 550, 1_250, 1_250]);
  });
});

describe('weeks the boat cannot come', () => {
  /* The same three pens as the shared week, with the boat's calendar changed
     underneath them. Nothing grows, so every figure is exact. */
  const pen = (penId, number, count, days) => ({
    penId,
    number,
    tgc: 3,
    conditionFactor: 1.2,
    treatments: [],
    events: log(`S24-${penId}`, [[`${penId}1`, days, 'stocked', count, 5_000]]),
  });
  const site = (weeklyCapacityT) => ({
    at: AT,
    maxBiomassT: 700,
    weeklyCapacityT,
    minHarvestWeightG: 4_300,
    temperatures: [],
    pens: [pen('PD', 1, 60_000, -400), pen('PE', 2, 50_000, -400), pen('PG', 3, 140_000, 17)],
  });

  it('pulls both lifts forward past a week with no boat in it', () => {
    const plan = planHarvest(site([2_000, 0, 2_000, 2_000]));
    expect(plan.bookings.map((booking) => booking.penId)).toEqual(['PD', 'PE']);
    expect(plan.bookings.map((booking) => booking.week)).toEqual([0, 0]);
  });

  it('which empties the site for a week', () => {
    const plan = planHarvest(site([2_000, 0, 2_000, 2_000]));
    expect(plan.weeklyBiomassT).toEqual([550, 0, 700, 700]);
  });

  it('takes the one week that has a boat at all', () => {
    const plan = planHarvest(site([0, 473, 0, 0]));
    expect(plan.bookings.map((booking) => booking.week)).toEqual([1, 1]);
    expect(plan.weeklyBiomassT).toEqual([550, 550, 700, 700]);
  });

  it('splits them where no week will take the pair', () => {
    const plan = planHarvest(site([300, 300, 300, 300]));
    expect(plan.bookings).toEqual([
      { penId: 'PE', week: 0, tonnes: 250, guttedT: 215, meanWeightG: 5_000 },
      { penId: 'PD', week: 1, tonnes: 300, guttedT: 258, meanWeightG: 5_000 },
    ]);
  });

  it('and finds nothing at all on a horizon of one week', () => {
    const plan = planHarvest({
      ...site([2_000]),
      maxBiomassT: 500,
    });
    expect(plan.bookings).toEqual([]);
    expect(plan.weeklyBiomassT).toEqual([550]);
    expect(plan.shortfall).toEqual({ week: 0, excessT: 50 });
  });

  it('a tonne over being as much a breach as fifty', () => {
    const plan = planHarvest({ ...site([2_000]), maxBiomassT: 549 });
    expect(plan.shortfall).toEqual({ week: 0, excessT: 1 });
  });
});

describe('three pens on one boat', () => {
  const pen = (penId, number, count, days) => ({
    penId,
    number,
    tgc: 3,
    conditionFactor: 1.2,
    treatments: [],
    events: log(`S24-${penId}`, [[`${penId}1`, days, 'stocked', count, 5_000]]),
  });
  const site = (weeklyCapacityT) => ({
    at: AT,
    maxBiomassT: 900,
    weeklyCapacityT,
    minHarvestWeightG: 4_300,
    temperatures: [],
    pens: [
      pen('PD', 1, 60_000, -400),
      pen('PE', 2, 50_000, -400),
      pen('PF', 3, 40_000, -400),
      pen('PG', 4, 160_000, 17),
    ],
  });

  it('puts all three in the same week', () => {
    const plan = planHarvest(site([2_000, 2_000, 2_000, 2_000]));
    expect(plan.bookings.map((booking) => booking.penId)).toEqual(['PD', 'PE', 'PF']);
    expect(plan.bookings.map((booking) => booking.week)).toEqual([1, 1, 1]);
  });

  it('landing 258, 215 and 172 t between them', () => {
    const plan = planHarvest(site([2_000, 2_000, 2_000, 2_000]));
    expect(plan.bookings.map((booking) => booking.guttedT)).toEqual([258, 215, 172]);
    expect(plan.weeklyBiomassT).toEqual([750, 750, 800, 800]);
  });

  it('and a slot of 645 is exactly enough for the three', () => {
    const plan = planHarvest(site([2_000, 645, 2_000, 2_000]));
    expect(plan.bookings.map((booking) => booking.week)).toEqual([1, 1, 1]);
  });

  it('while a hundredth under drops the highest number to the week before', () => {
    const plan = planHarvest(site([2_000, 644.99, 2_000, 2_000]));
    expect(plan.bookings).toEqual([
      { penId: 'PF', week: 0, tonnes: 200, guttedT: 172, meanWeightG: 5_000 },
      { penId: 'PD', week: 1, tonnes: 300, guttedT: 258, meanWeightG: 5_000 },
      { penId: 'PE', week: 1, tonnes: 250, guttedT: 215, meanWeightG: 5_000 },
    ]);
  });

  it('costing the site 200 t a week early', () => {
    const plan = planHarvest(site([2_000, 644.99, 2_000, 2_000]));
    expect(plan.weeklyBiomassT).toEqual([750, 550, 800, 800]);
  });
});

describe('which two of three go', () => {
  /* Three pens with nothing between them but their grid numbers, and a fourth
     arriving in week two that puts the site over. Two of the three have to go
     and the numbers are the only thing that decides which. */
  const pen = (penId, number, count, days) => ({
    penId,
    number,
    tgc: 3,
    conditionFactor: 1.2,
    treatments: [],
    events: log(`S24-${penId}`, [[`${penId}1`, days, 'stocked', count, 5_000]]),
  });
  const site = (weeklyCapacityT) => ({
    at: AT,
    maxBiomassT: 1_250,
    weeklyCapacityT,
    minHarvestWeightG: 4_300,
    temperatures: [],
    pens: [
      pen('PX', 7, 80_000, -400),
      pen('PY', 3, 80_000, -400),
      pen('PZ', 5, 80_000, -400),
      pen('PW', 9, 100_000, 17),
    ],
  });

  it('takes the two lowest numbers and leaves pen seven standing', () => {
    const plan = planHarvest(site([2_000, 2_000, 2_000, 2_000]));
    expect(plan.bookings.map((booking) => booking.penId)).toEqual(['PY', 'PZ']);
    expect(plan.bookings.map((booking) => booking.week)).toEqual([1, 1]);
  });

  it('holding the site at 1200 t and dropping it to 900', () => {
    const plan = planHarvest(site([2_000, 2_000, 2_000, 2_000]));
    expect(plan.weeklyBiomassT).toEqual([1_200, 1_200, 900, 900]);
  });

  it('fitting both into a slot of exactly 688 t', () => {
    const plan = planHarvest(site([2_000, 688, 2_000, 2_000]));
    expect(plan.bookings.map((booking) => booking.week)).toEqual([1, 1]);
  });

  it('and giving the later week to pen three when only one fits', () => {
    const plan = planHarvest(site([2_000, 687.99, 2_000, 2_000]));
    expect(plan.bookings).toEqual([
      { penId: 'PZ', week: 0, tonnes: 400, guttedT: 344, meanWeightG: 5_000 },
      { penId: 'PY', week: 1, tonnes: 400, guttedT: 344, meanWeightG: 5_000 },
    ]);
  });

  it('splitting them the same way on a boat that takes one pen a week', () => {
    const plan = planHarvest(site([344, 344, 2_000, 2_000]));
    expect(plan.bookings.map((booking) => booking.penId)).toEqual(['PZ', 'PY']);
    expect(plan.weeklyBiomassT).toEqual([1_200, 800, 900, 900]);
  });
});

describe('a site with nothing to plan', () => {
  const pen = (penId, number, count) => ({
    penId,
    number,
    tgc: 3,
    conditionFactor: 1.2,
    treatments: [],
    events: log(`S24-${penId}`, [[`${penId}1`, -400, 'stocked', count, 5_000]]),
  });

  it('reads no pens at all as a horizon of nothing', () => {
    const plan = planHarvest({
      at: AT,
      maxBiomassT: 100,
      weeklyCapacityT: [500, 500],
      minHarvestWeightG: 4_300,
      temperatures: [],
      pens: [],
    });
    expect(plan.weeklyBiomassT).toEqual([0, 0]);
    expect(plan.bookings).toEqual([]);
    expect(plan.shortfall).toBeNull();
    expect(plan.skipped).toEqual([]);
  });

  it('and reports the breach where nobody grades big enough to lift', () => {
    const plan = planHarvest({
      at: AT,
      maxBiomassT: 400,
      weeklyCapacityT: [2_000, 2_000],
      minHarvestWeightG: 4_301,
      temperatures: [],
      pens: [pen('PD', 1, 60_000), pen('PE', 2, 50_000)],
    });
    expect(plan.bookings).toEqual([]);
    expect(plan.shortfall).toEqual({ week: 0, excessT: 150 });
    expect(plan.weeklyBiomassT).toEqual([550, 550]);
  });
});

describe('a horizon long enough to need two boats', () => {
  const plan = planHarvest(ask({ weeklyCapacityT: Array.from({ length: 18 }, () => 600) }));

  it('cannot hold eighteen weeks on one pen', () => {
    expect(plan.bookings).toHaveLength(2);
    expect(plan.weeklyBiomassT).toHaveLength(18);
  });

  it('sends the first in week zero, 683.84 t landing 588.11 t', () => {
    expect(plan.bookings[0].penId).toBe('P1');
    expect(plan.bookings[0].week).toBe(0);
    expect(plan.bookings[0].tonnes).toBeCloseTo(683.8435, 3);
    expect(plan.bookings[0].guttedT).toBeCloseTo(588.1054, 3);
  });

  it('and holds the second back to week ten, by then 704.77 t at 4377.43 g', () => {
    expect(plan.bookings[1].penId).toBe('P4');
    expect(plan.bookings[1].week).toBe(10);
    expect(plan.bookings[1].tonnes).toBeCloseTo(704.7664, 3);
    expect(plan.bookings[1].meanWeightG).toBeCloseTo(4_377.4311, 3);
  });

  it('runs to 2412.46 t the week it lifts and 1771.69 t the week after', () => {
    expect(plan.weeklyBiomassT[10]).toBeCloseTo(2_412.4643, 3);
    expect(plan.weeklyBiomassT[11]).toBeCloseTo(1_771.6937, 3);
  });

  it('and finishes the horizon under licence, nothing skipped', () => {
    expect(plan.weeklyBiomassT[17]).toBeCloseTo(2_210.5471, 3);
    expect(plan.shortfall).toBeNull();
    expect(plan.skipped).toEqual([]);
  });
});

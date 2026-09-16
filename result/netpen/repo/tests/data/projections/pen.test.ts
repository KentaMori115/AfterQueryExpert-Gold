import { describe, expect, it } from 'vitest';

import { buildDataset } from '@/data/fixtures';
import { createContext, openGroupIn } from '@/data/projections/context';
import { projectPen } from '@/data/projections/pen';
import { NEAR_LICENCE_FRACTION, projectSite } from '@/data/projections/site';
import { parseInstant } from '@/domain/time/duration';

const NOW = parseInstant('2025-05-12T09:00:00Z');
const dataset = buildDataset(NOW);
const context = createContext(dataset);

function viewOf(penNumber: number) {
  const pen = context.penByNumber.get(penNumber);
  if (!pen) throw new Error(`No pen ${penNumber} in the fixture`);
  return projectPen({ context, pen, now: NOW });
}

describe('a stocked pen', () => {
  const view = viewOf(2);

  it('resolves its group and generation', () => {
    expect(view.group?.reference).toBe('S24-P2');
    expect(view.generation.code).toBe('S24');
    expect(view.weeksAtSea).toBeGreaterThan(50);
  });

  it('holds a plausible standing position', () => {
    expect(view.position?.count).toBeGreaterThan(60_000);
    expect(view.position?.meanWeightG).toBeGreaterThan(3_500);
    expect(view.biomassKg).toBeGreaterThan(300_000);
  });

  it('is inside the density limit', () => {
    expect(view.densityKgM3).toBeGreaterThan(5);
    expect(view.densityStatus).not.toBe('over-limit');
  });

  it('fits a growth coefficient near the budget', () => {
    expect(view.growth?.realisedTgc).toBeGreaterThan(2.5);
    expect(view.growth?.realisedTgc).toBeLessThan(3.6);
    expect(view.growth?.degreeDays).toBeGreaterThan(3_000);
    expect(typeof view.growth?.aheadOfBudget).toBe('boolean');
  });

  it('carries a lice count with an interval around it', () => {
    expect(view.lice.latest).not.toBeNull();
    expect(view.lice.averages?.adultFemale).toBeGreaterThanOrEqual(0);
    expect(view.lice.interval?.sampleSize).toBe(20);
    expect(view.lice.weekly.length).toBeGreaterThan(40);
  });

  it('carries an oxygen reading and the day low', () => {
    expect(view.oxygen.latest).not.toBeNull();
    expect(view.oxygen.dayLowPercent).not.toBeNull();
    expect(view.oxygen.dayLowPercent!).toBeLessThanOrEqual(
      view.oxygen.latest!.saturationPercent + 40,
    );
  });

  it('produces a feed plan naming the binding constraint', () => {
    expect(view.feed).not.toBeNull();
    expect(view.feed!.recommendedKg).toBeGreaterThanOrEqual(0);
    expect(view.feed!.binding).toBeTruthy();
  });

  it('reports mortality both cumulatively and as a daily rate', () => {
    expect(view.cumulativeMortalityPercent).toBeGreaterThan(0);
    expect(view.cumulativeMortalityPercent).toBeLessThan(30);
    expect(view.mortalityLevel).not.toBe('unknown');
  });
});

describe('the pens that are not carrying fish', () => {
  it('reports an emptied pen as having no group', () => {
    const view = viewOf(7);
    expect(openGroupIn(context, 'pen-7', NOW)).toBeNull();
    expect(view.group).toBeNull();
    expect(view.position).toBeNull();
    expect(view.biomassKg).toBe(0);
    expect(view.feed).toBeNull();
  });

  it('reports a pen under maintenance without inventing figures', () => {
    const view = viewOf(8);
    expect(view.pen.status).toBe('maintenance');
    expect(view.growth).toBeNull();
    expect(view.mortalityLevel).toBe('unknown');
  });
});

describe('the ulcer pen', () => {
  it('carries a much heavier cumulative mortality than a clean one', () => {
    expect(viewOf(5).cumulativeMortalityPercent!).toBeGreaterThan(
      viewOf(2).cumulativeMortalityPercent! * 1.5,
    );
  });

  it('shows a lower realised growth coefficient', () => {
    expect(viewOf(5).growth!.realisedTgc!).toBeLessThan(viewOf(2).growth!.realisedTgc!);
  });
});

describe('the harvesting pen', () => {
  it('has taken fish off and holds fewer than it was stocked with', () => {
    const view = viewOf(1);
    expect(view.position!.harvestedCount).toBeGreaterThan(0);
    expect(view.position!.count).toBeLessThan(view.position!.stockedCount * 0.8);
  });
});

describe('the site rolled up', () => {
  const site = projectSite({ context, now: NOW });

  it('counts only the pens holding fish', () => {
    expect(site.pens).toHaveLength(8);
    expect(site.stocked.length).toBeGreaterThan(3);
    expect(site.stocked.length).toBeLessThan(8);
  });

  it('puts the standing biomass against the licence', () => {
    expect(site.licence.standingT).toBeGreaterThan(500);
    expect(site.licence.limitT).toBe(2_500);
    expect(site.licence.utilisation).toBeCloseTo(site.licence.standingT / 2_500, 6);
  });

  it('projects the biomass forward week by week', () => {
    expect(site.projection).toHaveLength(27);
    expect(site.projection[0]?.biomassT).toBeCloseTo(site.licence.standingT, 0);
    expect(site.projection.at(-1)!.biomassT).toBeGreaterThan(site.projection[0]!.biomassT);
  });

  it('finds the week the ceiling arrives if nothing is harvested', () => {
    expect(site.weeksToBreach).not.toBeNull();
    expect(site.harvestRequiredT[site.weeksToBreach!]!).toBeGreaterThan(0);
    expect(site.harvestRequiredT[0]).toBe(0);
  });

  it('weights the site lice figure by the fish in each pen', () => {
    expect(site.siteLiceAverage).not.toBeNull();
    expect(site.siteLiceAverage!).toBeGreaterThanOrEqual(0);
  });

  it('raises alerts derived from the pens rather than invented', () => {
    expect(site.alerts.length).toBeGreaterThan(0);
    for (const alert of site.alerts) {
      expect(alert.key).toContain(alert.kind);
    }
  });

  it('warns about the licence only once it is close', () => {
    const near = site.alerts.some((alert) => alert.kind === 'biomass-near-licence');
    expect(near).toBe(site.licence.utilisation >= NEAR_LICENCE_FRACTION);
  });
});

/**
 * Lice counts and the treatments that answer them.
 *
 * Generated together, because they are not independent: the count drives the
 * treatment and the treatment drives the next count. A demonstration where the
 * two are written separately shows a site treating for no reason and lice
 * carrying on regardless, which teaches exactly the wrong thing about how the
 * decision actually works.
 *
 * The burden on a pen follows a seasonal driver - infestation pressure rises
 * through the summer as the water warms and the whole loch's lice mature
 * faster - climbing week on week until something knocks it back. That sawtooth
 * is the shape of every real lice record.
 */

import type { TreatmentEvent, TreatmentMethod } from '@/domain/health/treatment';
import { profileFor } from '@/domain/health/treatment';
import { countId, groupId, penId, treatmentId } from '@/domain/ids';
import { MINIMUM_SAMPLE, type FishCount } from '@/domain/lice/counts';
import { limitFor, type Regime } from '@/domain/lice/thresholds';
import { addWeeks, isoWeekOf, type Instant } from '@/domain/time/duration';
import { createRandom } from '@/lib/random';

export interface LiceCount {
  readonly id: ReturnType<typeof countId>;
  readonly groupId: ReturnType<typeof groupId>;
  readonly penId: ReturnType<typeof penId>;
  readonly countedAt: Instant;
  readonly countedBy: string;
  readonly sample: readonly FishCount[];
  readonly seaTemperatureC: number | null;
  readonly note: string;
}

/** What the generator produces per count, which is the regime's minimum. */
export const SAMPLE_SIZE = MINIMUM_SAMPLE;

/** How clustered the lice are. Lower is more clustered; 0.35 is typical. */
export const DISPERSION = 0.35;

/**
 * Weekly multiplier on the burden, by month. Lice mature faster in warm water
 * and the whole loch is carrying more of them, so a pen that holds steady
 * through February climbs hard through July.
 */
const SEASONAL_GROWTH = [1.02, 1.03, 1.06, 1.12, 1.2, 1.28, 1.3, 1.26, 1.18, 1.1, 1.05, 1.02];

export function seasonalGrowth(at: Instant): number {
  return SEASONAL_GROWTH[new Date(at).getUTCMonth()] ?? 1.1;
}

/** The methods a site rotates through, so resistance does not build. */
export const METHOD_ROTATION: readonly TreatmentMethod[] = [
  'thermal',
  'hydrogen-peroxide',
  'freshwater',
  'emamectin-benzoate',
  'mechanical-brush',
];

export interface LiceHistory {
  readonly counts: readonly LiceCount[];
  readonly treatments: readonly TreatmentEvent[];
}

export interface LiceOptions {
  readonly penNumbers: readonly number[];
  readonly stockedAt: Instant;
  readonly weeks: number;
  readonly regime: Regime;
  /** Weekly sea temperature at the reference depth, for the record. */
  readonly temperatureAt: (at: Instant) => number;
  /** Weeks before a pen is treated once it is over, mirroring the grace. */
  readonly weeksToAct?: number;
}

/**
 * Split a burden across the stages. Adult females are what is regulated, but
 * they are the tail of a population: for every adult female there are rather
 * more pre-adults coming behind her, and that ratio is what tells a site
 * whether next week is going to be worse.
 */
function sampleFish(adultFemaleMean: number, random: ReturnType<typeof createRandom>): FishCount {
  const adultFemale = random.negativeBinomial(adultFemaleMean, DISPERSION);
  const preAdult = random.negativeBinomial(adultFemaleMean * 1.8, DISPERSION);
  const adultMale = random.negativeBinomial(adultFemaleMean * 0.7, DISPERSION);
  const chalimus = random.negativeBinomial(adultFemaleMean * 2.4, DISPERSION * 1.4);
  const caligus = random.negativeBinomial(0.25, 0.5);

  return { chalimus, preAdult, adultMale, adultFemale, caligus };
}

export function buildLiceHistory(options: LiceOptions): LiceHistory {
  const counts: LiceCount[] = [];
  const treatments: TreatmentEvent[] = [];
  const weeksToAct = options.weeksToAct ?? 2;

  for (const penNumber of options.penNumbers) {
    const random = createRandom(`lice-p${penNumber}`);
    const pen = penId(`pen-${penNumber}`);
    const group = groupId(`grp-s24-p${penNumber}`);

    // Smolt go to sea clean; the burden builds from almost nothing.
    let burden = random.between(0.01, 0.04);
    let weeksOver = 0;
    let rotation = penNumber % METHOD_ROTATION.length;
    let treatmentNumber = 0;

    for (let week = 2; week <= options.weeks; week += 1) {
      const at = addWeeks(options.stockedAt, week);
      burden = burden * seasonalGrowth(at) * random.between(0.94, 1.1) + random.between(0, 0.012);

      const sample = Array.from({ length: SAMPLE_SIZE }, () => sampleFish(burden, random));
      const observed = sample.reduce((total, fish) => total + fish.adultFemale, 0) / SAMPLE_SIZE;

      counts.push({
        id: countId(`cnt-p${penNumber}-w${week}`),
        groupId: group,
        penId: pen,
        countedAt: at,
        countedBy: 'per-oduya',
        sample,
        seaTemperatureC: Number(options.temperatureAt(at).toFixed(1)),
        note: '',
      });

      const limit = limitFor(options.regime, isoWeekOf(at));
      weeksOver = observed > limit ? weeksOver + 1 : 0;

      if (weeksOver >= weeksToAct) {
        const method = METHOD_ROTATION[rotation % METHOD_ROTATION.length]!;
        rotation += 1;
        treatmentNumber += 1;

        const before = burden;
        // Real efficacy scatters either side of the profile's typical figure.
        const achieved = profileFor(method).typicalEfficacy * random.between(0.82, 1.08);
        burden = Math.max(0.005, burden * (1 - Math.min(0.97, achieved)));

        treatments.push({
          id: treatmentId(`trt-p${penNumber}-${treatmentNumber}`),
          method,
          completedAt: addWeeks(at, 1),
          penId: String(pen),
          beforeCount: Number(before.toFixed(3)),
          afterCount: Number(burden.toFixed(3)),
          note: `Pen ${penNumber}, ${profileFor(method).label.toLowerCase()}`,
        });

        weeksOver = 0;
      }
    }
  }

  return { counts, treatments };
}

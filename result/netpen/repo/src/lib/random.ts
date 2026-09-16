/**
 * Seeded pseudo-randomness.
 *
 * The demonstration dataset has to look like a real site - noisy, uneven, with
 * a bad week in it - while being byte for byte identical on every machine that
 * loads it. A screenshot taken on Monday has to match the report on Friday and
 * a test that asserts on a lice count has to keep passing.
 *
 * The distributions here are not decoration. Lice counts are overdispersed:
 * they cluster on a handful of fish far more than chance allows, so generating
 * them from a Poisson produces a tidy sample that the interval code then reads
 * as far more certain than any real count. The negative binomial is what
 * actually fits, and generating from it means the sampling statistics
 * downstream are exercised against data with the right shape.
 *
 * sfc32 is used because it is small, has a long period, and passes the tests
 * that matter for this. It is emphatically not for anything security related.
 */

export interface RandomSource {
  /** Uniform in [0, 1). */
  next(): number;
  between(low: number, high: number): number;
  /** Integer in [low, high], inclusive at both ends. */
  int(low: number, high: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  normal(mean: number, standardDeviation: number): number;
  /** Gamma with the given shape and scale. */
  gamma(shape: number, scale: number): number;
  poisson(mean: number): number;
  /**
   * Negative binomial by its mean and dispersion. Lower dispersion means more
   * clustering; a k around 0.3 is typical for sea lice on a pen.
   */
  negativeBinomial(mean: number, dispersion: number): number;
}

export function seedFromString(text: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function createRandom(seed: number | string): RandomSource {
  const base = (typeof seed === 'string' ? seedFromString(seed) : seed) >>> 0;

  let a = base ^ 0x9e3779b9;
  let b = base ^ 0x243f6a88;
  let c = base ^ 0xb7e15162;
  let d = 1;

  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4_294_967_296;
  };

  // The generator needs a few turns before its state is well mixed.
  for (let warm = 0; warm < 12; warm += 1) next();

  const source: RandomSource = {
    next,
    between(low, high) {
      return low + next() * (high - low);
    },
    int(low, high) {
      if (high < low) throw new RangeError('Upper bound must not be below the lower bound');
      return low + Math.floor(next() * (high - low + 1));
    },
    chance(probability) {
      return next() < probability;
    },
    pick(items) {
      if (items.length === 0) throw new RangeError('Cannot pick from an empty list');
      return items[Math.floor(next() * items.length)]!;
    },
    normal(mean, standardDeviation) {
      // Box-Muller. The guard keeps the log away from zero.
      const u = Math.max(next(), Number.EPSILON);
      const v = next();
      return mean + standardDeviation * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    gamma(shape, scale) {
      if (shape <= 0 || scale <= 0) {
        throw new RangeError('Gamma needs a positive shape and scale');
      }
      // Marsaglia and Tsang. Shapes below one are handled by boosting.
      if (shape < 1) {
        return (
          source.gamma(shape + 1, scale) * Math.pow(Math.max(next(), Number.EPSILON), 1 / shape)
        );
      }

      const d = shape - 1 / 3;
      const c = 1 / Math.sqrt(9 * d);

      for (let attempt = 0; attempt < 1_000; attempt += 1) {
        const z = source.normal(0, 1);
        const v = (1 + c * z) ** 3;
        if (v <= 0) continue;
        const u = Math.max(next(), Number.EPSILON);
        if (Math.log(u) < 0.5 * z * z + d - d * v + d * Math.log(v)) {
          return d * v * scale;
        }
      }
      return d * scale;
    },
    poisson(mean) {
      if (mean < 0) throw new RangeError('Poisson needs a non negative mean');
      if (mean === 0) return 0;

      if (mean < 30) {
        // Knuth. Fine at the counts a lice sample produces.
        const limit = Math.exp(-mean);
        let count = 0;
        let product = next();
        while (product > limit) {
          count += 1;
          product *= next();
        }
        return count;
      }

      // Normal approximation with a continuity correction, then clamped.
      const draw = Math.round(source.normal(mean, Math.sqrt(mean)));
      return draw > 0 ? draw : 0;
    },
    negativeBinomial(mean, dispersion) {
      if (mean <= 0) return 0;
      if (dispersion <= 0) throw new RangeError('Dispersion must be positive');
      // Gamma-Poisson mixture: the gamma supplies the clustering.
      return source.poisson(source.gamma(dispersion, mean / dispersion));
    },
  };

  return source;
}

/** Deterministic shuffle, for laying out demo data without an obvious order. */
export function shuffle<T>(items: readonly T[], random: RandomSource): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = random.int(0, index);
    const held = copy[index]!;
    copy[index] = copy[swap]!;
    copy[swap] = held;
  }
  return copy;
}

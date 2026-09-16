/**
 * Dissolved oxygen.
 *
 * The constraint that actually limits a marine site. Biomass is capped by a
 * licence, but appetite is capped by oxygen, and on a still warm day with a
 * neap tide the pen runs out of the second long before it approaches the
 * first. Everything about summer feeding is really a conversation about this.
 *
 * Two separate quantities get called "oxygen" and confusing them is the
 * classic mistake. Concentration in milligrammes per litre is what a probe
 * reads. Saturation as a percentage is concentration against what the water
 * could hold at that temperature and salinity, and it is what the fish
 * experience, because the gradient driving oxygen across a gill is a partial
 * pressure. Cold water at 8 mg/L is a comfortable 80 percent; warm water at
 * the same 8 mg/L is over saturated and about to gas-bubble a smolt.
 *
 * Solubility follows Garcia and Gordon's 1992 refit of the Benson and Krause
 * data, which is the standard for sea water and is what every oceanographic
 * dataset is reported against.
 */

/** Garcia and Gordon combined fit, micromoles per kilogramme. */
const A = [5.80818, 3.20684, 4.1189, 4.93845, 1.01567, 1.41575] as const;
const B = [-7.01211e-3, -7.25958e-3, -7.93334e-3, -5.54491e-3] as const;
const C0 = -1.32412e-7;

/** Molar mass of dioxygen, grammes per mole. */
export const O2_MOLAR_MASS = 31.9988;

/**
 * Sea water density, grammes per litre. A linear approximation good to about a
 * part in a thousand over the range a farm sees, which is an order better than
 * the probes being corrected.
 */
export function seaWaterDensity(temperatureC: number, salinityPsu: number): number {
  return 1_000 + 0.7 * salinityPsu - 0.2 * temperatureC;
}

/** Oxygen solubility at one atmosphere, micromoles per kilogramme. */
export function solubilityUmolKg(temperatureC: number, salinityPsu: number): number {
  const scaled = Math.log((298.15 - temperatureC) / (273.15 + temperatureC));

  let lnC =
    A[0] +
    A[1] * scaled +
    A[2] * scaled ** 2 +
    A[3] * scaled ** 3 +
    A[4] * scaled ** 4 +
    A[5] * scaled ** 5;

  lnC +=
    salinityPsu * (B[0] + B[1] * scaled + B[2] * scaled ** 2 + B[3] * scaled ** 3) +
    C0 * salinityPsu ** 2;

  return Math.exp(lnC);
}

/** Oxygen solubility at one atmosphere, milligrammes per litre. */
export function solubilityMgL(temperatureC: number, salinityPsu: number): number {
  const umolKg = solubilityUmolKg(temperatureC, salinityPsu);
  const density = seaWaterDensity(temperatureC, salinityPsu);
  return (umolKg * O2_MOLAR_MASS * density) / 1_000_000;
}

/** What a probe reading means as a percentage of what the water could hold. */
export function saturationPercent(
  measuredMgL: number,
  temperatureC: number,
  salinityPsu: number,
): number {
  const capacity = solubilityMgL(temperatureC, salinityPsu);
  if (capacity <= 0) return 0;
  return (measuredMgL / capacity) * 100;
}

/** The concentration a target saturation corresponds to. */
export function concentrationForSaturation(
  saturation: number,
  temperatureC: number,
  salinityPsu: number,
): number {
  return (solubilityMgL(temperatureC, salinityPsu) * saturation) / 100;
}

/**
 * Routine oxygen consumption, milligrammes per kilogramme of fish per hour.
 *
 * Allometric in weight and exponential in temperature. A larger fish uses less
 * per kilogramme than a smaller one, which is why a pen's total demand grows
 * more slowly than its biomass.
 */
export const CONSUMPTION_COEFFICIENT = 61.6;
export const CONSUMPTION_WEIGHT_EXPONENT = -0.2;
export const CONSUMPTION_TEMPERATURE_COEFFICIENT = 0.061;

export function routineConsumptionMgKgH(meanWeightG: number, temperatureC: number): number {
  if (meanWeightG <= 0) {
    throw new RangeError('Oxygen demand needs a positive fish weight');
  }
  const weightKg = meanWeightG / 1_000;
  return (
    CONSUMPTION_COEFFICIENT *
    weightKg ** CONSUMPTION_WEIGHT_EXPONENT *
    Math.exp(CONSUMPTION_TEMPERATURE_COEFFICIENT * temperatureC)
  );
}

/**
 * Multiplier on the routine rate while digesting a meal. Feeding roughly
 * doubles demand for several hours, which is why the low point of the day is
 * mid afternoon and not dawn as people expect.
 */
export const FED_ACTIVITY_MULTIPLIER = 1.9;

export function consumptionMgKgH(meanWeightG: number, temperatureC: number, fed: boolean): number {
  const routine = routineConsumptionMgKgH(meanWeightG, temperatureC);
  return fed ? routine * FED_ACTIVITY_MULTIPLIER : routine;
}

/** A whole pen's demand, kilogrammes of oxygen per hour. */
export function penDemandKgH(
  biomassKg: number,
  meanWeightG: number,
  temperatureC: number,
  fed: boolean,
): number {
  return (biomassKg * consumptionMgKgH(meanWeightG, temperatureC, fed)) / 1_000_000;
}

/**
 * Water exchange needed to hold the outflow above a floor, cubic metres per
 * second. This is the number a site compares against the tidal current through
 * the pen, and it is what says whether a slack neap is survivable.
 */
export function requiredFlowM3S(demandKgH: number, inletMgL: number, floorMgL: number): number {
  const drawdown = inletMgL - floorMgL;
  if (drawdown <= 0) return Number.POSITIVE_INFINITY;
  // kg/h over mg/L gives m3/h once the units are lined up; then to seconds.
  return (demandKgH * 1_000_000) / (drawdown * 1_000) / 3_600;
}

export type OxygenBand = 'critical' | 'low' | 'reduced' | 'good' | 'supersaturated';

/**
 * Bands the site acts on. Appetite starts falling below about 70 percent, feed
 * is stopped below 60, and above 110 the risk turns into gas bubble trauma
 * rather than suffocation.
 */
export function oxygenBand(saturation: number): OxygenBand {
  if (!Number.isFinite(saturation)) return 'critical';
  if (saturation < 50) return 'critical';
  if (saturation < 60) return 'low';
  if (saturation < 70) return 'reduced';
  if (saturation <= 110) return 'good';
  return 'supersaturated';
}

export const OXYGEN_BAND_LABELS: Record<OxygenBand, string> = {
  critical: 'Critical, stop feeding and consider aeration',
  low: 'Low, hold feed until it recovers',
  reduced: 'Reduced, feed at a lower rate',
  good: 'Comfortable',
  supersaturated: 'Supersaturated, watch for gas bubble trauma',
};

export function formatSaturation(saturation: number | null): string {
  if (saturation === null || !Number.isFinite(saturation)) return '—';
  return `${saturation.toFixed(0)} %`;
}

export function formatConcentration(mgL: number | null): string {
  if (mgL === null || !Number.isFinite(mgL)) return '—';
  return `${mgL.toFixed(2)} mg/L`;
}

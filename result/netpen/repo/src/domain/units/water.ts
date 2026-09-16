/**
 * Sea water measurements.
 *
 * Temperature, salinity and depth, with the conventions a site actually uses.
 * Sea temperature is logged at fixed depths rather than as one number, because
 * the difference between the surface and five metres is what decides whether
 * the fish are sitting on the bottom of the pen, and because the lice count
 * threshold and the feeding table read the same profile differently.
 *
 * Salinity is carried as practical salinity, which is dimensionless. It is
 * written with the PSU suffix anyway, because a bare "33" on a screen next to
 * a temperature of "12" is asking to be misread.
 */

export type TemperatureUnit = 'C' | 'F';

/** Depths a site is required to log at, in metres. */
export const LOGGED_DEPTHS_M = [1, 3, 5, 10, 15] as const;
export type LoggedDepth = (typeof LOGGED_DEPTHS_M)[number];

/** The depth feeding decisions are taken against unless a site says otherwise. */
export const REFERENCE_DEPTH_M: LoggedDepth = 5;

export function celsiusToFahrenheit(celsius: number): number {
  return celsius * 1.8 + 32;
}

export function fahrenheitToCelsius(fahrenheit: number): number {
  return (fahrenheit - 32) / 1.8;
}

export function convertTemperature(
  value: number,
  from: TemperatureUnit,
  to: TemperatureUnit,
): number {
  if (from === to) return value;
  return from === 'C' ? celsiusToFahrenheit(value) : fahrenheitToCelsius(value);
}

/**
 * Convert a temperature difference. An interval of 2 K is 3.6 degF, not 35.6,
 * and a growth model fed the wrong one silently predicts the wrong harvest.
 */
export function convertTemperatureDelta(
  value: number,
  from: TemperatureUnit,
  to: TemperatureUnit,
): number {
  if (from === to) return value;
  return from === 'C' ? value * 1.8 : value / 1.8;
}

/**
 * Sea water freezes below about -1.9 degC at full salinity, and no North
 * Atlantic site sees above 25. Outside this a probe is out of the water.
 */
export const SEA_TEMPERATURE_MIN_C = -2;
export const SEA_TEMPERATURE_MAX_C = 25;

export function isPlausibleSeaTemperature(celsius: number): boolean {
  return (
    Number.isFinite(celsius) && celsius >= SEA_TEMPERATURE_MIN_C && celsius <= SEA_TEMPERATURE_MAX_C
  );
}

/**
 * Practical salinity. Open Atlantic sits near 35, a sheltered fjord head with
 * river input can drop to the low twenties in spate.
 */
export const SALINITY_MIN_PSU = 0;
export const SALINITY_MAX_PSU = 40;

export function isPlausibleSalinity(psu: number): boolean {
  return Number.isFinite(psu) && psu >= SALINITY_MIN_PSU && psu <= SALINITY_MAX_PSU;
}

/**
 * Brackish enough that lice treatment by freshwater bathing loses its effect
 * and the osmotic load on the fish changes. Sites watch for this in spring.
 */
export const BRACKISH_THRESHOLD_PSU = 25;

export function isBrackish(psu: number): boolean {
  return psu < BRACKISH_THRESHOLD_PSU;
}

export function formatTemperature(celsius: number | null, unit: TemperatureUnit = 'C'): string {
  if (celsius === null || !Number.isFinite(celsius)) return '—';
  return `${convertTemperature(celsius, 'C', unit).toFixed(1)} °${unit}`;
}

export function formatSalinity(psu: number | null): string {
  if (psu === null || !Number.isFinite(psu)) return '—';
  return `${psu.toFixed(1)} PSU`;
}

export function formatDepth(metres: number | null): string {
  if (metres === null || !Number.isFinite(metres)) return '—';
  return `${metres.toFixed(0)} m`;
}

/** A reading taken at one depth at one moment. */
export interface DepthReading {
  readonly depthM: number;
  readonly temperatureC: number;
  readonly salinityPsu: number | null;
}

/**
 * Pick the reading a decision should be taken against: the requested depth if
 * it was logged, otherwise the nearest logged depth, preferring the deeper of
 * two equidistant ones because that is the more conservative reading for both
 * oxygen and lice.
 */
export function readingAtDepth(
  readings: readonly DepthReading[],
  depthM: number,
): DepthReading | null {
  if (readings.length === 0) return null;
  let best = readings[0]!;
  let bestGap = Math.abs(best.depthM - depthM);

  for (const reading of readings) {
    const gap = Math.abs(reading.depthM - depthM);
    if (gap < bestGap || (gap === bestGap && reading.depthM > best.depthM)) {
      best = reading;
      bestGap = gap;
    }
  }
  return best;
}

/** Difference between the shallowest and deepest logged temperature. */
export function stratificationK(readings: readonly DepthReading[]): number | null {
  if (readings.length < 2) return null;
  const temperatures = readings.map((reading) => reading.temperatureC);
  return Math.max(...temperatures) - Math.min(...temperatures);
}

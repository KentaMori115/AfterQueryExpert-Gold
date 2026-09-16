/**
 * The one error this library throws, and the guards that throw it.
 *
 * Every refusal carries the name of the quantity that was wrong. On a
 * winding installation there are thirty figures on a sheet — the depth,
 * the rope diameter, the drum diameter, the payload, the speed, the
 * acceleration, half a dozen masses — and "that is not a number" is not
 * a message. "The rope diameter is not a number" is.
 */

/** Everything this library refuses, it refuses with one of these. */
export class WindingError extends Error {
  /** The quantity that was wrong. */
  readonly quantity: string;

  /** Build one, naming the quantity. */
  constructor(message: string, quantity = "quantity") {
    super(message);
    this.name = "WindingError";
    this.quantity = quantity;
  }
}

/** Refuse unless something holds. */
export function insist(so: boolean, says: string, quantity = "quantity"): void {
  if (!so) throw new WindingError(says, quantity);
}

/** A number that is a number. */
export function real(value: number, quantity = "value"): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WindingError(`${quantity} must be a number, not ${String(value)}`, quantity);
  }
  return value;
}

/** A number above nought. */
export function positive(value: number, quantity = "value"): number {
  real(value, quantity);
  if (value <= 0) throw new WindingError(`${quantity} must be above nought, not ${value}`, quantity);
  return value;
}

/** A number at or above nought. */
export function nonNegative(value: number, quantity = "value"): number {
  real(value, quantity);
  if (value < 0) throw new WindingError(`${quantity} cannot be negative, and ${value} is`, quantity);
  return value;
}

/** A number inside a band, with the band the right way round. */
export function within(value: number, low: number, high: number, quantity = "value"): number {
  real(value, quantity);
  if (low > high) throw new WindingError(`${quantity} was given a band from ${low} to ${high}`, quantity);
  if (value < low || value > high) {
    throw new WindingError(`${quantity} must be between ${low} and ${high}, and ${value} is not`, quantity);
  }
  return value;
}

/** A percentage, which is between nought and a hundred. */
export function percentage(value: number, quantity = "percentage"): number {
  return within(value, 0, 100, quantity);
}

/** A share, which is between nought and one. */
export function share(value: number, quantity = "share"): number {
  return within(value, 0, 1, quantity);
}

/** A whole number of things, which cannot be a fraction of a thing. */
export function count(value: number, quantity = "count"): number {
  real(value, quantity);
  if (!Number.isInteger(value) || value < 0) {
    throw new WindingError(`${quantity} must be a whole number of things, not ${value}`, quantity);
  }
  return value;
}

/**
 * A depth, in metres.
 *
 * Nought is the bank and the deepest shaft ever sunk is a little over
 * four thousand metres, so anything outside that is a figure somebody
 * has typed in the wrong units — which on a winding sheet is nearly
 * always feet read as metres or the other way about.
 */
export function depth(value: number, quantity = "depth"): number {
  return within(value, 0, 4200, quantity);
}

/**
 * A rope speed, in metres a second.
 *
 * Twenty is the fastest anything has ever been wound and twelve is the
 * fastest men are wound anywhere.
 */
export function speed(value: number, quantity = "speed"): number {
  return within(value, 0, 25, quantity);
}

/** A factor of safety, which is a ratio above one or the rope has broken. */
export function factor(value: number, quantity = "factor"): number {
  real(value, quantity);
  if (value <= 1) throw new WindingError(`a factor of safety of ${value} is not a factor of safety`, quantity);
  return value;
}

/** One of a fixed set of words, or a refusal that says which they are. */
export function choose<T extends string>(
  value: string,
  known: readonly T[],
  quantity = "choice",
): T {
  const found = known.find((each) => each === value.trim());
  if (found === undefined) {
    throw new WindingError(`${value} is not one this library knows (${known.join(", ")})`, quantity);
  }
  return found;
}

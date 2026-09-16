import type { Amperes, Ohms } from "../core/units.js";
import { amperes, ohms, raw } from "../core/units.js";

/**
 * Whether the match will actually light.
 *
 * An electric match is a bridgewire with a pyrotechnic head on it. Push enough
 * current through the bridge and it heats until the head takes; push too
 * little and it sits there warming up and does nothing, which is worse than a
 * clean failure because the crew cannot tell it apart from a dud.
 *
 * Two currents matter and both are properties of the match, not the panel. The
 * no fire current is the most it can carry indefinitely and stay safe to
 * approach. The all fire current is the least that will reliably light it
 * within the panel's pulse. Between them is a band where it might, and no show
 * should have a circuit sitting in that band.
 */

export interface MatchSpec {
  readonly name: string;
  readonly resistance: Ohms;
  readonly noFire: Amperes;
  readonly allFire: Amperes;
}

export const MATCHES: readonly MatchSpec[] = [
  {
    name: "standard",
    resistance: ohms(1.9),
    noFire: amperes(0.2),
    allFire: amperes(0.7),
  },
  {
    name: "low-current",
    resistance: ohms(1.2),
    noFire: amperes(0.15),
    allFire: amperes(0.45),
  },
  {
    name: "talon",
    resistance: ohms(2.4),
    noFire: amperes(0.25),
    allFire: amperes(0.9),
  },
];

export function matchNamed(name: string): MatchSpec | undefined {
  return MATCHES.find((spec) => spec.name === name.toLowerCase());
}

/** Resistance of a length of firing line, both legs counted. */
export function leadResistance(metres: number, ohmsPerMetre = 0.07): Ohms {
  if (metres < 0) {
    throw new RangeError("a lead cannot be a negative length");
  }
  return ohms(metres * 2 * ohmsPerMetre);
}

export interface Circuit {
  /** How many matches are wired in series on this one output. */
  readonly matches: number;
  readonly spec: MatchSpec;
  /** Resistance of the wire out and back. */
  readonly lead: Ohms;
}

export function circuitResistance(circuit: Circuit): Ohms {
  return ohms(
    circuit.matches * raw(circuit.spec.resistance) + raw(circuit.lead),
  );
}

export function firingCurrent(circuit: Circuit, voltage: number): Amperes {
  const resistance = raw(circuitResistance(circuit));
  if (resistance <= 0) {
    throw new RangeError("a circuit with no resistance is a short");
  }
  return amperes(voltage / resistance);
}

export type CircuitVerdict = "fires" | "marginal" | "will-not-fire";

/**
 * Where the circuit sits against the match's own thresholds. `marginal` is the
 * band between no fire and all fire, and it is the answer a shooter has to
 * act on, because a marginal circuit works on the bench and fails in the cold.
 */
export function verdictFor(circuit: Circuit, voltage: number): CircuitVerdict {
  const current = raw(firingCurrent(circuit, voltage));
  if (current >= raw(circuit.spec.allFire)) {
    return "fires";
  }
  if (current > raw(circuit.spec.noFire)) {
    return "marginal";
  }
  return "will-not-fire";
}

/** The most matches that will still all fire on one output at this voltage. */
export function maxSeriesMatches(
  spec: MatchSpec,
  lead: Ohms,
  voltage: number,
): number {
  const wanted = raw(spec.allFire);
  if (wanted <= 0) {
    throw new RangeError("a match with no all fire current makes no sense");
  }
  const budget = voltage / wanted - raw(lead);
  return Math.max(0, Math.floor(budget / raw(spec.resistance)));
}

/**
 * A parallel pair is the classic field bodge, and it is worth being able to
 * describe it in order to refuse it. The lower resistance branch takes more of
 * the current, so one match lights, its bridge opens, and the other is left
 * with the full circuit and no current at all.
 */
export function parallelShare(
  first: Ohms,
  second: Ohms,
  total: Amperes,
): [Amperes, Amperes] {
  const a = raw(first);
  const b = raw(second);
  if (a <= 0 || b <= 0) {
    throw new RangeError("a parallel branch needs a real resistance");
  }
  const current = raw(total);
  return [amperes((current * b) / (a + b)), amperes((current * a) / (a + b))];
}

/** How unevenly a parallel pair shares, as a fraction of the larger share. */
export function parallelImbalance(first: Ohms, second: Ohms): number {
  const [a, b] = parallelShare(first, second, amperes(1));
  const high = Math.max(raw(a), raw(b));
  const low = Math.min(raw(a), raw(b));
  return high === 0 ? 0 : (high - low) / high;
}

export function describeCircuit(circuit: Circuit, voltage: number): string {
  const resistance = raw(circuitResistance(circuit)).toFixed(1);
  const current = raw(firingCurrent(circuit, voltage)).toFixed(2);
  return `${circuit.matches} x ${circuit.spec.name}, ${resistance} ohm, ${current} A, ${verdictFor(circuit, voltage)}`;
}

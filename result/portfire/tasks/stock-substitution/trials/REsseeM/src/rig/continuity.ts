import type { Circuit, MatchSpec } from "./circuit.js";
import { circuitResistance, firingCurrent, verdictFor } from "./circuit.js";
import type { PinAddress } from "./pin.js";
import { comparePins, formatPin, parsePin, pinKey } from "./pin.js";
import type { Rig } from "./rig.js";
import { readTable } from "../core/csv.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { ohms, raw } from "../core/units.js";
import type { Ohms } from "../core/units.js";

/**
 * Checking the field against what the show expects.
 *
 * Every panel can walk its outputs and report what it sees on each one. That
 * report is the only evidence anybody has that the field is wired the way the
 * table assumes, and reading it by eye across four hundred pins is exactly the
 * job a person does badly at eleven at night.
 *
 * Three findings matter and they are not equally serious. A pin the show fires
 * that reads open will not go, which is a dead cue. A pin the show does not
 * fire that reads connected is something wired that nothing will light, which
 * is worse, because it is usually a lead on the wrong terminal and the cue it
 * belongs to is the one that will not go. A pin with a resistance well outside
 * what the circuit should read is a bad joint that may or may not fire.
 */

export type PinReading = "open" | "connected" | "short";

export interface ContinuityRow {
  readonly address: PinAddress;
  readonly reading: PinReading;
  readonly resistance?: Ohms;
}

export interface ContinuityReport {
  readonly rows: readonly ContinuityRow[];
  readonly diagnostics: DiagnosticBag;
}

/**
 * Read a panel's continuity dump. The column names differ between makers, so
 * the reader accepts several spellings for the same thing rather than making
 * a crew rename columns on the night.
 */
export function parseContinuity(
  text: string,
  source: string,
): ContinuityReport {
  const diagnostics = new DiagnosticBag();
  const table = readTable(text);
  const rows: ContinuityRow[] = [];

  const addressColumn = ["pin", "address", "cue", "output"].find((name) =>
    table.headers.includes(name),
  );
  const readingColumn = ["state", "reading", "status", "continuity"].find(
    (name) => table.headers.includes(name),
  );
  if (addressColumn === undefined || readingColumn === undefined) {
    diagnostics.error({
      code: "PF1400",
      message: `${source} does not have a pin column and a state column`,
      help: "the pin column may be pin, address, cue or output",
    });
    return { rows, diagnostics };
  }

  for (const record of table.records) {
    const where = `${source} line ${record.line}`;
    const address = parsePin(record.values.get(addressColumn) ?? "");
    if (address === undefined) {
      diagnostics.error({
        code: "PF1401",
        message: `${where} has no readable pin address`,
      });
      continue;
    }
    const state = (record.values.get(readingColumn) ?? "").trim().toLowerCase();
    const reading = readingFrom(state);
    if (reading === undefined) {
      diagnostics.error({
        code: "PF1402",
        message: `${where} has a state of ${state || "(blank)"}`,
        help: "a state is open, connected, ok, good or short",
      });
      continue;
    }
    const resistanceText = (record.values.get("ohms") ?? "").trim();
    const resistance = Number(resistanceText);
    rows.push({
      address,
      reading,
      ...(resistanceText.length > 0 &&
      Number.isFinite(resistance) &&
      resistance >= 0
        ? { resistance: ohms(resistance) }
        : {}),
    });
  }
  return { rows, diagnostics };
}

function readingFrom(state: string): PinReading | undefined {
  if (["open", "o", "none", "no"].includes(state)) {
    return "open";
  }
  if (["connected", "ok", "good", "c", "yes", "pass"].includes(state)) {
    return "connected";
  }
  if (["short", "shorted", "s"].includes(state)) {
    return "short";
  }
  return undefined;
}

export interface Reconciliation {
  /** Fired by the show and reads open, so the cue will not go. */
  readonly dead: readonly PinAddress[];
  /** Not fired by the show and reads connected, so a lead is on the wrong pin. */
  readonly stray: readonly PinAddress[];
  /** Shorted, which the panel may refuse to arm at all. */
  readonly shorted: readonly PinAddress[];
  /** Fired by the show and never reported, so the walk missed it. */
  readonly unreported: readonly PinAddress[];
}

export function reconcile(
  expected: Iterable<PinAddress>,
  rows: readonly ContinuityRow[],
): Reconciliation {
  const wanted = new Map(
    [...expected].map((address) => [pinKey(address), address]),
  );
  const seen = new Set<string>();
  const dead: PinAddress[] = [];
  const stray: PinAddress[] = [];
  const shorted: PinAddress[] = [];

  for (const row of rows) {
    const key = pinKey(row.address);
    seen.add(key);
    const isWanted = wanted.has(key);
    if (row.reading === "short") {
      shorted.push(row.address);
      continue;
    }
    if (isWanted && row.reading === "open") {
      dead.push(row.address);
      continue;
    }
    if (!isWanted && row.reading === "connected") {
      stray.push(row.address);
    }
  }

  const unreported = [...wanted.entries()]
    .filter(([key]) => !seen.has(key))
    .map(([, address]) => address);

  return {
    dead: dead.sort(comparePins),
    stray: stray.sort(comparePins),
    shorted: shorted.sort(comparePins),
    unreported: unreported.sort(comparePins),
  };
}

export function checkReconciliation(result: Reconciliation): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const address of result.dead) {
    diagnostics.error({
      code: "PF1410",
      message: `${formatPin(address)} is fired by the show and reads open`,
    });
  }
  for (const address of result.shorted) {
    diagnostics.error({
      code: "PF1411",
      message: `${formatPin(address)} reads shorted`,
      help: "a short can stop the module arming at all, find it before the show",
    });
  }
  for (const address of result.stray) {
    diagnostics.error({
      code: "PF1412",
      message: `${formatPin(address)} is wired and the show never fires it`,
      help: "this is usually a lead one terminal out, so a real cue is dead too",
    });
  }
  for (const address of result.unreported) {
    diagnostics.warning({
      code: "PF1413",
      message: `${formatPin(address)} is fired by the show and the walk never reported it`,
    });
  }
  return diagnostics;
}

/**
 * Whether a measured resistance is what the circuit should read. A joint that
 * has been twisted rather than crimped reads a couple of ohms high and fires
 * on the bench, which is the failure this catches.
 */
export function resistanceLooksRight(
  measured: Ohms,
  circuit: Circuit,
  tolerance = 1.5,
): boolean {
  const expected = raw(circuitResistance(circuit));
  return Math.abs(raw(measured) - expected) <= tolerance;
}

export function checkResistances(
  rows: readonly ContinuityRow[],
  spec: MatchSpec,
  lead: Ohms,
  voltage: number,
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  const circuit: Circuit = { matches: 1, spec, lead };
  for (const row of rows) {
    if (row.resistance === undefined || row.reading !== "connected") {
      continue;
    }
    if (!resistanceLooksRight(row.resistance, circuit)) {
      const current = raw(firingCurrent({ ...circuit }, voltage)).toFixed(2);
      diagnostics.warning({
        code: "PF1414",
        message: `${formatPin(row.address)} reads ${raw(row.resistance).toFixed(1)} ohm against an expected ${raw(circuitResistance(circuit)).toFixed(1)}`,
        help: `a clean circuit would draw ${current}A and ${verdictFor(circuit, voltage)}`,
      });
    }
  }
  return diagnostics;
}

/** Every pin the rig has that the walk never mentioned. */
export function unwalkedPins(
  rig: Rig,
  rows: readonly ContinuityRow[],
): PinAddress[] {
  const seen = new Set(rows.map((row) => pinKey(row.address)));
  return rig.allPins().filter((address) => !seen.has(pinKey(address)));
}

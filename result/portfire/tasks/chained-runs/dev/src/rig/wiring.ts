import type { Assignment } from "./allocate.js";
import type { Circuit, MatchSpec } from "./circuit.js";
import { firingCurrent, leadResistance, verdictFor } from "./circuit.js";
import { formatPin } from "./pin.js";
import type { Rig } from "./rig.js";
import { distanceBetween } from "./rig.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { sum } from "../core/numeric.js";
import { renderTable } from "../core/text.js";
import { ohms, raw } from "../core/units.js";
import type { Ohms } from "../core/units.js";
import { isFollower } from "../timeline/fusing.js";

/**
 * The wire on the ground.
 *
 * Every cue is a pair of legs from a module out to a mortar and back, and the
 * length of that pair decides whether the match sees enough current. Nobody
 * measures each run, so the practical model is the distance from the module's
 * position to the mortar's, plus a slack allowance for the fact that wire does
 * not run in straight lines across a field with a hedge in it.
 *
 * The number that matters is not the average run. It is the longest one,
 * because that is the circuit that fails, and it will be the one furthest from
 * where anybody stood while testing.
 */

/** Wire never runs straight. This is the multiplier crews use in practice. */
export const SLACK_FACTOR = 1.3;

/** Slack at each end for the tie off and the mortar itself. */
export const END_SLACK_METRES = 4;

/**
 * How far apart mortars stand within one rack. A position is a rack, not a
 * point, and the fortieth tube in a line is a long way from the module at the
 * end of it. This is the term that actually makes runs vary on a real site,
 * since a module almost always stands at the position it serves.
 */
export const MORTAR_SPACING_METRES = 1.5;

export interface Run {
  readonly assignment: Assignment;
  /** Metres of lead, one way, including slack. */
  readonly metres: number;
  readonly resistance: Ohms;
}

export function runLength(straightMetres: number, indexInRack = 0): number {
  const alongTheRack = Math.max(0, indexInRack) * MORTAR_SPACING_METRES;
  return (straightMetres + alongTheRack) * SLACK_FACTOR + END_SLACK_METRES;
}

/**
 * The runs a show needs. A cue fired from the same position its module stands
 * at still needs a lead, because the mortar is not bolted to the case, so the
 * end slack applies even at zero distance.
 */
export function runsFor(
  assignments: readonly Assignment[],
  rig: Rig,
  ohmsPerMetre = 0.07,
): Run[] {
  const runs: Run[] = [];
  const seenAtPosition = new Map<string, number>();
  for (const assignment of assignments) {
    // One lead per circuit. The rest of a chained run is joined to the head
    // by quickmatch, not by wire back to the module.
    if (isFollower(assignment.shot)) {
      continue;
    }
    const unit = rig.module(assignment.address.module);
    const target = rig.position(assignment.shot.position);
    if (unit === undefined || target === undefined) {
      continue;
    }
    const home = rig.position(unit.position);
    const straight = home === undefined ? 0 : distanceBetween(home, target);
    const index = seenAtPosition.get(assignment.shot.position) ?? 0;
    seenAtPosition.set(assignment.shot.position, index + 1);
    const metres = runLength(straight, index);
    runs.push({
      assignment,
      metres,
      resistance: leadResistance(metres, ohmsPerMetre),
    });
  }
  return runs;
}

export interface WiringReport {
  readonly runs: readonly Run[];
  /** Metres of wire, counting both legs of every run. */
  readonly totalMetres: number;
  readonly longest?: Run;
  readonly worstResistance: Ohms;
}

export function wiringReport(
  assignments: readonly Assignment[],
  rig: Rig,
  ohmsPerMetre = 0.07,
): WiringReport {
  const runs = runsFor(assignments, rig, ohmsPerMetre);
  let longest: Run | undefined;
  for (const run of runs) {
    if (longest === undefined || run.metres > longest.metres) {
      longest = run;
    }
  }
  return {
    runs,
    totalMetres: sum(runs.map((run) => run.metres * 2)),
    ...(longest === undefined ? {} : { longest }),
    worstResistance: longest?.resistance ?? ohms(0),
  };
}

/**
 * Check every run against the match it will carry. The check is done on the
 * longest run rather than on all of them only because they share a verdict,
 * but each marginal one is still named, since a crew rerouting cable needs to
 * know which leads to shorten.
 */
export function checkWiring(
  report: WiringReport,
  spec: MatchSpec,
  voltage: number,
  matchesPerCue = 1,
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const run of report.runs) {
    const circuit: Circuit = {
      matches: matchesPerCue,
      spec,
      lead: run.resistance,
    };
    const verdict = verdictFor(circuit, voltage);
    if (verdict === "fires") {
      continue;
    }
    const address = formatPin(run.assignment.address);
    const current = raw(firingCurrent(circuit, voltage)).toFixed(2);
    if (verdict === "will-not-fire") {
      diagnostics.error({
        code: "PF1500",
        message: `${address} would draw ${current}A over ${run.metres.toFixed(0)}m of lead and needs ${raw(spec.allFire)}A`,
        help: "shorten the run, move the module closer, or raise the voltage",
      });
    } else {
      diagnostics.warning({
        code: "PF1501",
        message: `${address} draws ${current}A, between no fire and all fire`,
        help: "a marginal circuit works on the bench and fails in the cold",
      });
    }
  }
  return diagnostics;
}

/** The longest run a match will still fire over, for planning a rig. */
export function maxRunMetres(
  spec: MatchSpec,
  voltage: number,
  ohmsPerMetre = 0.07,
  matchesPerCue = 1,
): number {
  const budget = voltage / raw(spec.allFire);
  const forMatches = matchesPerCue * raw(spec.resistance);
  const forLead = budget - forMatches;
  if (forLead <= 0) {
    return 0;
  }
  return forLead / (2 * ohmsPerMetre);
}

export function describeWiring(report: WiringReport): string {
  if (report.longest === undefined) {
    return "no runs";
  }
  const address = formatPin(report.longest.assignment.address);
  return `${report.runs.length} runs, ${report.totalMetres.toFixed(0)}m of wire, longest ${report.longest.metres.toFixed(0)}m to ${address}`;
}

/** A wire order, grouped by position, which is how cable is carried out. */
export function cableByPosition(report: WiringReport): string {
  const totals = new Map<string, { runs: number; metres: number }>();
  for (const run of report.runs) {
    const position = run.assignment.shot.position;
    const held = totals.get(position) ?? { runs: 0, metres: 0 };
    held.runs += 1;
    held.metres += run.metres * 2;
    totals.set(position, held);
  }
  const rows = [...totals.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([position, held]) => [
      position,
      String(held.runs),
      held.metres.toFixed(0),
    ]);
  return renderTable(
    [
      { header: "position" },
      { header: "runs", align: "right" },
      { header: "metres", align: "right" },
    ],
    rows,
  );
}

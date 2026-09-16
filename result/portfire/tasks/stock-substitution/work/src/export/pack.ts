import { describeDraw, stockSummary } from "../catalog/draw.js";
import type { DrawResult } from "../catalog/draw.js";
import { describePalette, palette } from "../catalog/palette.js";
import type { Catalog } from "../catalog/registry.js";
import { hazardTotals, transportLines } from "../catalog/hazard.js";
import { countBy } from "../core/collect.js";
import { summarise } from "../core/diagnostic.js";
import type { DiagnosticBag } from "../core/diagnostic.js";
import { raw } from "../core/units.js";
import { describeAllocation } from "../rig/allocate.js";
import type { Rig } from "../rig/rig.js";
import { describeLayout, rackNeeds } from "../rig/layout.js";
import { describeRedundancy, planRedundancy } from "../rig/redundancy.js";
import type { Assignment } from "../rig/allocate.js";
import { describeBalance } from "../timeline/balance.js";
import { describeChain, chainCandidates } from "../timeline/chain.js";
import { densityReport, describeDensity } from "../timeline/density.js";
import { describeLoad, loadReport } from "../timeline/load.js";
import { driftReport } from "../timeline/quantise.js";
import type { QuantisedSchedule } from "../timeline/quantise.js";
import { cueSheet, sheetHeader, wiringSheet } from "./sheets.js";
import { permitDocument } from "./permit.js";
import type { PermitDetails } from "./permit.js";
import type { Site } from "../safety/site.js";
import type { DistanceRule } from "../safety/distance.js";

/**
 * Everything, in one document.
 *
 * A show goes out of the office as a folder of paper, and the folder is always
 * assembled by hand from six commands run in the wrong order. Half the value
 * of this is that the numbers in it all came from one compile, so the cue
 * sheet and the permit cannot disagree about how many shells there are.
 *
 * The sections are in the order they get used rather than the order they were
 * computed. Summary first because somebody flicks to it, then the paper the
 * crew carries, then the paperwork nobody reads until it is asked for.
 */

export interface PackSection {
  readonly title: string;
  readonly body: string;
}

export interface PackOptions {
  readonly name: string;
  readonly rig: Rig;
  readonly assignments?: readonly Assignment[];
  readonly diagnostics?: DiagnosticBag;
  readonly site?: Site;
  readonly permit?: PermitDetails;
  readonly rule?: DistanceRule;
  /** Leave these sections out, by title. */
  readonly without?: readonly string[];
  /** What was drawn from the magazine, for a show compiled against stock. */
  readonly stock?: DrawResult;
  /** The catalog the stock was drawn against, for the stand-in table. */
  readonly catalog?: Catalog;
}

function summarySection(
  schedule: QuantisedSchedule,
  options: PackOptions,
): string {
  const density = densityReport(schedule);
  const drift = driftReport(schedule);
  const counts = countBy(schedule.events, (event) => event.effectId);
  const effects = new Map(
    schedule.events.map((event) => [event.effectId, event.effect]),
  );
  const hazard = hazardTotals([...effects.values()], counts);
  const lines = [
    `show          ${options.name}`,
    `cues          ${schedule.events.length}`,
    `effects used  ${effects.size}`,
    `runs          ${(raw(schedule.duration) / 1000).toFixed(1)}s`,
    `frame rate    ${schedule.format.rate}${schedule.format.dropFrame ? " drop" : ""}`,
    `pre roll      ${(raw(schedule.preRoll) / 1000).toFixed(1)}s`,
    `worst drift   ${drift.worst.toFixed(1)}ms`,
    `peak lit      ${density.peak}`,
    `net explosive ${(hazard.totalGrams / 1000).toFixed(2)}kg, ${hazard.worst ?? "none"}`,
  ];
  if (options.stock !== undefined) {
    lines.push(`stock         ${stockSummary(options.stock)}`);
  }
  if (options.diagnostics !== undefined) {
    lines.push(`diagnostics   ${summarise(options.diagnostics)}`);
  }
  return lines.join("\n");
}

export function packSections(
  schedule: QuantisedSchedule,
  options: PackOptions,
): PackSection[] {
  const sections: PackSection[] = [
    { title: "summary", body: summarySection(schedule, options) },
    { title: "shape", body: sheetHeader(schedule, options.name) },
    {
      title: "cue sheet",
      body: cueSheet(schedule, { lot: options.stock !== undefined }),
    },
    { title: "wiring sheet", body: wiringSheet(schedule, options.rig) },
  ];

  if (options.assignments !== undefined) {
    sections.push({
      title: "rack layout",
      body: describeLayout(rackNeeds(options.assignments)),
    });
    sections.push({
      title: "pin list",
      body: describeAllocation(options.assignments),
    });
  }

  if (options.assignments !== undefined) {
    const plans = planRedundancy(options.assignments, options.rig);
    sections.push({
      title: "doubling",
      body: describeRedundancy(plans),
    });
  }

  const loads = loadReport(schedule, options.rig);
  sections.push({
    title: "module load",
    body:
      loads.length === 0 ? "nothing fires" : loads.map(describeLoad).join("\n"),
  });

  sections.push({
    title: "density",
    body: describeDensity(densityReport(schedule)),
  });
  sections.push({
    title: "balance",
    body: describeBalance(schedule, options.rig),
  });

  const effects = new Map(
    schedule.events.map((event) => [event.effectId, event.effect]),
  );
  const counts = countBy(schedule.events, (event) => event.effectId);
  sections.push({
    title: "palette",
    body: describePalette(palette([...effects.values()], counts)),
  });

  const chains = chainCandidates(schedule);
  sections.push({
    title: "chains",
    body:
      chains.length === 0
        ? "no run in this show is worth chaining"
        : chains.map(describeChain).join("\n"),
  });

  sections.push({
    title: "transport",
    body:
      transportLines(hazardTotals([...effects.values()], counts)).join("\n") ||
      "nothing to transport",
  });

  if (options.stock !== undefined && options.catalog !== undefined) {
    sections.push({
      title: "stock",
      body: describeDraw(options.stock, options.catalog),
    });
  }

  if (options.site !== undefined && options.permit !== undefined) {
    sections.push({
      title: "permit",
      body: permitDocument(
        schedule,
        options.rig,
        options.site,
        options.permit,
        options.rule,
      ),
    });
  }

  const skip = new Set(options.without ?? []);
  return sections.filter((section) => !skip.has(section.title));
}

function rule(title: string): string {
  return `${title}\n${"=".repeat(title.length)}`;
}

export function showPack(
  schedule: QuantisedSchedule,
  options: PackOptions,
): string {
  return packSections(schedule, options)
    .map((section) => `${rule(section.title)}\n\n${section.body}`)
    .join("\n\n\n");
}

/** The section titles a pack can hold, for a command's help text. */
export function sectionTitles(): string[] {
  return [
    "summary",
    "shape",
    "cue sheet",
    "wiring sheet",
    "rack layout",
    "pin list",
    "doubling",
    "module load",
    "density",
    "balance",
    "palette",
    "chains",
    "transport",
    "stock",
    "permit",
  ];
}

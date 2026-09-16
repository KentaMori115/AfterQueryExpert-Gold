import { drawShots } from "./catalog/draw.js";
import type { Draw } from "./catalog/draw.js";
import type { Magazine } from "./catalog/inventory.js";
import type { Catalog } from "./catalog/registry.js";
import { DiagnosticBag } from "./core/diagnostic.js";
import { SourceFile } from "./core/span.js";
import { SMPTE_25 } from "./core/timecode.js";
import type { TimecodeFormat } from "./core/timecode.js";
import { ms, raw } from "./core/units.js";
import type { Milliseconds } from "./core/units.js";
import { allocatePins } from "./rig/allocate.js";
import type { AllocationOptions, Assignment } from "./rig/allocate.js";
import type { Rig } from "./rig/rig.js";
import type { SafetyContext, SafetyVerdict } from "./safety/rules.js";
import { checkSafety } from "./safety/rules.js";
import { expandScript } from "./script/expand.js";
import { checkDuplicateGroups, loadScript } from "./script/include.js";
import type { FileReader } from "./script/include.js";
import { parseScript } from "./script/parser.js";
import { resolveShots } from "./script/resolve.js";
import type { Script } from "./script/ast.js";
import { checkDensity } from "./timeline/density.js";
import type { DensityLimits } from "./timeline/density.js";
import { checkLoad } from "./timeline/load.js";
import type { LoadOptions } from "./timeline/load.js";
import { checkQuantisation, quantiseSchedule } from "./timeline/quantise.js";
import type { QuantisedSchedule } from "./timeline/quantise.js";
import { buildSchedule } from "./timeline/schedule.js";
import { checkBalance } from "./timeline/balance.js";
import type { BalanceLimits } from "./timeline/balance.js";
import { suggestChains } from "./timeline/chain.js";
import { checkPalette, palette } from "./catalog/palette.js";
import type { PaletteLimits } from "./catalog/palette.js";
import { countBy } from "./core/collect.js";

/**
 * The whole thing, in one call.
 *
 * Seven stages, each of which can fail, and none of which should stop the ones
 * that do not depend on it. A script with an unknown effect name still gets
 * its load and density checked on the cues that did resolve, because a shooter
 * fixing one problem wants to see the others in the same pass rather than
 * discovering them one round trip at a time.
 *
 * The one place that does stop is parsing. A script that does not parse has no
 * statements to work on, and pressing ahead would produce diagnostics about an
 * empty show that say nothing useful.
 */

export interface CompileOptions {
  readonly catalog: Catalog;
  readonly rig: Rig;
  /**
   * The stock the show is fired out of. Given one, every cue draws a real unit
   * from a real lot and a cue the magazine cannot supply is offered a stand-in,
   * so the table describes the shells the crew has rather than the ones the
   * catalog lists. The book itself is left exactly as it was handed in.
   */
  readonly magazine?: Magazine;
  /** Lot numbers set aside before the draw: a recall, or stock held back. */
  readonly pull?: readonly string[];
  readonly format?: TimecodeFormat;
  readonly seed?: string;
  readonly safety?: Omit<SafetyContext, "rig">;
  readonly density?: DensityLimits;
  readonly load?: LoadOptions;
  readonly allocation?: AllocationOptions;
  /** Move the whole show forward so nothing fires before zero. */
  readonly absorbPreRoll?: boolean;
  /**
   * Run the checks that are matters of judgement rather than of fact: how
   * even the show is across the field, how varied its effects are, and which
   * runs could be chained. They are off by default because they are notes and
   * a shooter checking a script forty times a day does not want them every
   * time.
   */
  readonly advice?: boolean;
  readonly balance?: BalanceLimits;
  readonly paletteLimits?: PaletteLimits;
  /**
   * How to read an included file. Without this an `include` line parses and
   * then does nothing, which is worse than not supporting includes at all,
   * because the show compiles and is missing whatever the include held.
   */
  readonly read?: FileReader;
}

export interface CompileResult {
  readonly script: Script;
  readonly schedule: QuantisedSchedule;
  /**
   * The pin assignments behind the schedule. A schedule is per event and has
   * thrown the shot away, so anything that wants the rack layout or the pin
   * list needs these. Two commands were walking the show a second time to
   * rebuild them, which was both wasteful and a chance for the second walk to
   * disagree with the first.
   */
  readonly assignments: readonly Assignment[];
  /**
   * What the draw did, when a magazine was given. Present even when nothing
   * was substituted, because a report wants to say that as well.
   */
  readonly draw?: Draw;
  readonly diagnostics: DiagnosticBag;
  readonly safety?: SafetyVerdict;
  /** True when nothing raised an error, so the table is fit to load. */
  readonly ok: boolean;
  readonly preRoll: Milliseconds;
}

/**
 * Read the frame rate the script asked for, falling back to the caller's and
 * then to twenty five. A script that names a rate wins, because the rate is a
 * property of the audio the show is cut to.
 */
function formatFor(script: Script, fallback: TimecodeFormat): TimecodeFormat {
  for (const statement of script.statements) {
    if (statement.kind === "frame") {
      const rate = statement.rate;
      if (rate === 24 || rate === 25 || rate === 30) {
        return { rate, dropFrame: statement.dropFrame };
      }
    }
  }
  return fallback;
}

function seedFor(script: Script, fallback: string | undefined): string {
  for (const statement of script.statements) {
    if (statement.kind === "seed") {
      return statement.seed;
    }
  }
  for (const statement of script.statements) {
    if (statement.kind === "show") {
      return statement.name;
    }
  }
  return fallback ?? "portfire";
}

export function compile(
  source: string,
  name: string,
  options: CompileOptions,
): CompileResult {
  const parsed =
    options.read === undefined
      ? parseScript(new SourceFile(name, source))
      : loadScript(name, (path) =>
          path === name ? source : options.read?.(path),
        );
  const diagnostics = new DiagnosticBag().addAll(parsed.diagnostics.all());
  if (options.read !== undefined) {
    diagnostics.addAll(checkDuplicateGroups(parsed.script).all());
  }
  const format = formatFor(parsed.script, options.format ?? SMPTE_25);

  if (diagnostics.hasErrors()) {
    return {
      script: parsed.script,
      schedule: { events: [], format, preRoll: ms(0), duration: ms(0) },
      assignments: [],
      diagnostics,
      ok: false,
      preRoll: ms(0),
    };
  }

  const seed = seedFor(parsed.script, options.seed);
  const expanded = expandScript(parsed.script.statements, { seed });
  diagnostics.addAll(expanded.diagnostics.all());

  const resolved = resolveShots(expanded.shots, options.catalog, options.rig);
  diagnostics.addAll(resolved.diagnostics.all());

  // The draw sits between resolving and allocation on purpose. A stand-in has
  // its own lead, its own separation distance and its own pin, so everything
  // after this point has to be looking at what will really be in the mortar.
  let draw: Draw | undefined;
  if (options.magazine !== undefined) {
    draw = drawShots(resolved.shots, options.catalog, options.magazine, {
      ...(options.pull === undefined ? {} : { pull: options.pull }),
    });
    diagnostics.addAll(draw.diagnostics.all());
  }

  const allocated = allocatePins(
    draw?.shots ?? resolved.shots,
    options.rig,
    options.allocation ?? {},
  );
  diagnostics.addAll(allocated.diagnostics.all());

  let schedule = buildSchedule(allocated.assignments);
  if ((options.absorbPreRoll ?? false) && raw(schedule.preRoll) > 0) {
    const shifted = schedule.events.map((event) => ({
      ...event,
      ignitionAt: ms(raw(event.ignitionAt) + raw(schedule.preRoll)),
      visibleAt: ms(raw(event.visibleAt) + raw(schedule.preRoll)),
      occupancy: {
        start: ms(raw(event.occupancy.start) + raw(schedule.preRoll)),
        end: ms(raw(event.occupancy.end) + raw(schedule.preRoll)),
      },
    }));
    schedule = { events: shifted, preRoll: ms(0), duration: schedule.duration };
  }
  const preRoll = schedule.preRoll;
  const quantised = quantiseSchedule(schedule, format);

  diagnostics.addAll(checkQuantisation(quantised).all());
  diagnostics.addAll(
    checkLoad(quantised, options.rig, options.load ?? {}).all(),
  );
  diagnostics.addAll(checkDensity(quantised, options.density ?? {}).all());

  if (options.advice ?? false) {
    diagnostics.addAll(
      checkBalance(quantised, options.rig, options.balance ?? {}).all(),
    );
    diagnostics.addAll(suggestChains(quantised).all());
    const counts = countBy(quantised.events, (event) => event.effectId);
    const effects = new Map(
      quantised.events.map((event) => [event.effectId, event.effect]),
    );
    diagnostics.addAll(
      checkPalette(
        palette([...effects.values()], counts),
        options.paletteLimits ?? {},
      ).all(),
    );
  }

  let safety: SafetyVerdict | undefined;
  if (options.safety !== undefined) {
    safety = checkSafety(quantised, { ...options.safety, rig: options.rig });
    diagnostics.addAll(safety.diagnostics.all());
  }

  return {
    script: parsed.script,
    schedule: quantised,
    assignments: allocated.assignments,
    ...(draw === undefined ? {} : { draw }),
    diagnostics,
    ...(safety === undefined ? {} : { safety }),
    ok: !diagnostics.hasErrors(),
    preRoll,
  };
}

/** A one line verdict for the top of a report or the end of a CLI run. */
export function summariseCompile(result: CompileResult): string {
  const cues = result.schedule.events.length;
  const errors = result.diagnostics.errorCount;
  const warnings = result.diagnostics.warningCount;
  const verdict = result.ok ? "ready" : "not ready";
  return `${verdict}, ${cues} cues, ${errors} errors, ${warnings} warnings`;
}

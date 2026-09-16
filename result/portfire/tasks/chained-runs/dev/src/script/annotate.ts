import type { CueStatement, Script, Statement } from "./ast.js";
import { isCueStatement, shotsIn } from "./ast.js";
import { distinct } from "../core/collect.js";
import { isFollower } from "../timeline/fusing.js";
import type { SourceFile } from "../core/span.js";
import { formatShowTime } from "../core/timecode.js";
import { raw } from "../core/units.js";
import { formatPin } from "../rig/pin.js";
import type { QuantisedSchedule } from "../timeline/quantise.js";
import type { Schedule } from "../timeline/schedule.js";

/**
 * Writing the compiled answer back into the script.
 *
 * A designer reads the script, not the firing table, and the two numbers that
 * matter to them are not in the script. When does this actually fire, and
 * which pins did it take. Putting both in a trailing comment means the file a
 * designer edits carries its own answers, and a diff of an annotated script
 * shows the consequence of a change as well as the change.
 *
 * The comments are regenerated rather than merged, so an annotated script can
 * be annotated again without the comments stacking up.
 */

const MARK = "#>";

export function stripAnnotations(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      const at = line.indexOf(MARK);
      return at === -1 ? line : line.slice(0, at).trimEnd();
    })
    .join("\n");
}

interface CueFacts {
  readonly firesAt: string;
  readonly pins: readonly string[];
}

/**
 * Match statements to the events they produced. The link is the statement's
 * span, which every shot carries through expansion, so a macro's shots come
 * back to the one line that wrote them.
 */
function factsByLine(
  script: Script,
  schedule: Schedule | QuantisedSchedule,
  file: SourceFile,
): Map<number, CueFacts> {
  const cues: CueStatement[] = [];
  for (const statement of script.statements) {
    if (statement.kind === "group") {
      cues.push(...statement.body);
      continue;
    }
    if (isCueStatement(statement)) {
      cues.push(statement);
    }
  }

  const facts = new Map<number, CueFacts>();

  // Statements are matched to events by the times they asked for, in order.
  // A play of a group is left alone, since its body is annotated where it is
  // written rather than where it is played.
  const remaining = [...schedule.events].sort(
    (a, b) => raw(a.visibleAt) - raw(b.visibleAt),
  );
  for (const statement of cues) {
    if (statement.kind === "play") {
      continue;
    }
    const wanted = shotsIn(statement);
    const taken = remaining.splice(0, wanted);
    if (taken.length === 0) {
      continue;
    }
    const line = file.positionAt(statement.span.start).line;
    const first = taken[0];
    if (first === undefined) {
      continue;
    }
    // A chained run answers with its one pin and how many shots hang off it,
    // since listing the same address a dozen times tells a designer nothing.
    const fused = taken.filter(isFollower).length;
    const pins = distinct(taken, (event) => formatPin(event.address));
    facts.set(line, {
      firesAt: formatShowTime(first.ignitionAt),
      pins:
        fused === 0
          ? pins
          : [`${pins.join(" ")} chained, ${taken.length} shots`],
    });
  }
  return facts;
}

export interface AnnotateOptions {
  /** Show the pins as well as the firing time. */
  readonly pins?: boolean;
  /** Longest run of pins to spell out before summarising it as a range. */
  readonly maxPins?: number;
}

function pinText(pins: readonly string[], maxPins: number): string {
  if (pins.length === 0) {
    return "";
  }
  if (pins.length <= maxPins) {
    return pins.join(" ");
  }
  const first = pins[0] ?? "";
  const last = pins[pins.length - 1] ?? "";
  return `${first} to ${last}, ${pins.length} pins`;
}

export function annotateScript(
  source: string,
  script: Script,
  schedule: Schedule | QuantisedSchedule,
  file: SourceFile,
  options: AnnotateOptions = {},
): string {
  const facts = factsByLine(script, schedule, file);
  const maxPins = options.maxPins ?? 4;
  const showPins = options.pins ?? true;
  return stripAnnotations(source)
    .split("\n")
    .map((line, index) => {
      const found = facts.get(index + 1);
      if (found === undefined || line.trim().length === 0) {
        return line;
      }
      const parts = [`fires ${found.firesAt}`];
      if (showPins) {
        const pins = pinText(found.pins, maxPins);
        if (pins.length > 0) {
          parts.push(pins);
        }
      }
      return `${line.trimEnd()}  ${MARK} ${parts.join(", ")}`;
    })
    .join("\n");
}

/** Whether a source already carries annotations, so a caller can warn. */
export function isAnnotated(source: string): boolean {
  return source.includes(MARK);
}

/** How many statements the annotation could place, for a sanity report. */
export function annotatedLines(
  script: Script,
  schedule: Schedule | QuantisedSchedule,
  file: SourceFile,
): number {
  return factsByLine(script, schedule, file).size;
}

/** Statements that produce shots, which is what can be annotated at all. */
export function annotatableStatements(script: Script): Statement[] {
  return script.statements.filter(
    (statement) => isCueStatement(statement) && statement.kind !== "play",
  );
}

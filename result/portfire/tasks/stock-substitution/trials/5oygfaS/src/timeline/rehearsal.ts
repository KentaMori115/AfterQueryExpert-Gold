import type { QuantisedSchedule } from "./quantise.js";
import type { FiringEvent, Schedule } from "./schedule.js";
import { countBy, sortedEntries } from "../core/collect.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { renderTable } from "../core/text.js";
import { formatShowTime } from "../core/timecode.js";
import { ms, raw } from "../core/units.js";
import type { Milliseconds } from "../core/units.js";
import { formatPin } from "../rig/pin.js";
import type { Rig } from "../rig/rig.js";

/**
 * Running the show with nothing on the end of the wires.
 *
 * Before anything is loaded, the panel runs the whole table into a field full
 * of nothing, and somebody watches the lights on the modules. It is the only
 * end to end test the system gets, and what it proves is that the panel
 * understood the table, which is a different question from whether the table
 * is right.
 *
 * What this produces is the script for that: what to watch, when, and what it
 * means if it does not happen. The value is in the last part. A crew watching
 * lights with no idea which module should blink when learns nothing from the
 * exercise.
 */

export interface RehearsalStep {
  readonly at: Milliseconds;
  readonly module: number;
  /** How many outputs that module closes at this instant. */
  readonly outputs: number;
  readonly pins: readonly string[];
  /** What a crew member should see. */
  readonly expect: string;
}

/** Steps closer than this read as one event to somebody watching. */
export const WATCH_WINDOW_MS = 250;

export function rehearsalSteps(
  schedule: Schedule | QuantisedSchedule,
  windowMs = WATCH_WINDOW_MS,
): RehearsalStep[] {
  const sorted = [...schedule.events].sort(
    (a, b) => raw(a.ignitionAt) - raw(b.ignitionAt),
  );
  const steps: RehearsalStep[] = [];
  let bucket: FiringEvent[] = [];
  let anchor = 0;

  const flush = (): void => {
    if (bucket.length === 0) {
      return;
    }
    const byModule = countBy(bucket, (event) => String(event.address.module));
    for (const [moduleText, outputs] of sortedEntries(byModule)) {
      const module = Number(moduleText);
      const pins = bucket
        .filter((event) => event.address.module === module)
        .map((event) => formatPin(event.address));
      steps.push({
        at: ms(anchor),
        module,
        outputs,
        pins,
        expect:
          outputs === 1
            ? `one light on module ${module}`
            : `${outputs} lights on module ${module}`,
      });
    }
    bucket = [];
  };

  for (const event of sorted) {
    const at = raw(event.ignitionAt);
    if (bucket.length === 0) {
      anchor = at;
      bucket.push(event);
      continue;
    }
    if (at - anchor <= windowMs) {
      bucket.push(event);
      continue;
    }
    flush();
    anchor = at;
    bucket.push(event);
  }
  flush();
  return steps.sort((a, b) => raw(a.at) - raw(b.at) || a.module - b.module);
}

/** How many people it takes to watch, one per module in use. */
export function watchersNeeded(schedule: Schedule | QuantisedSchedule): number {
  return new Set(schedule.events.map((event) => event.address.module)).size;
}

export interface RehearsalPlan {
  readonly steps: readonly RehearsalStep[];
  readonly watchers: number;
  readonly duration: Milliseconds;
  /** Modules the show never fires, so nobody needs to watch them. */
  readonly idleModules: readonly number[];
}

export function rehearsalPlan(
  schedule: Schedule | QuantisedSchedule,
  rig: Rig,
  windowMs = WATCH_WINDOW_MS,
): RehearsalPlan {
  const steps = rehearsalSteps(schedule, windowMs);
  const used = new Set(schedule.events.map((event) => event.address.module));
  const last = steps[steps.length - 1];
  return {
    steps,
    watchers: used.size,
    duration: last?.at ?? ms(0),
    idleModules: rig.moduleNumbers().filter((number) => !used.has(number)),
  };
}

export function describeRehearsal(plan: RehearsalPlan): string {
  if (plan.steps.length === 0) {
    return "nothing to rehearse";
  }
  return renderTable(
    [
      { header: "at", align: "right" },
      { header: "module", align: "right" },
      { header: "outputs", align: "right" },
      { header: "watch for" },
      { header: "pins", maxWidth: 40 },
    ],
    plan.steps.map((step) => [
      formatShowTime(step.at),
      String(step.module),
      String(step.outputs),
      step.expect,
      step.pins.join(" "),
    ]),
  );
}

/**
 * Things a rehearsal cannot tell you apart. Two cues on one module inside the
 * watch window look like one longer light, so a crew that sees the right
 * number of blinks has not proved the right number of outputs closed.
 */
export function ambiguousSteps(plan: RehearsalPlan): RehearsalStep[] {
  return plan.steps.filter((step) => step.outputs > 1);
}

export function checkRehearsal(plan: RehearsalPlan): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  const ambiguous = ambiguousSteps(plan);
  if (ambiguous.length > 0) {
    diagnostics.note({
      code: "PF3700",
      message: `${ambiguous.length} moments close more than one output on one module`,
      help: "a watcher cannot count those, check them on the panel's own log instead",
    });
  }
  if (plan.idleModules.length > 0) {
    diagnostics.note({
      code: "PF3701",
      message: `modules ${plan.idleModules.join(", ")} fire nothing, so nobody need watch them`,
    });
  }
  if (plan.watchers > 6) {
    diagnostics.warning({
      code: "PF3702",
      message: `${plan.watchers} modules are in use and a crew that size will not all be watching`,
      help: "rehearse in passes, one group of modules at a time",
    });
  }
  return diagnostics;
}

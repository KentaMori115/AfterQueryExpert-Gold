import { SHOW_FLAGS, outcomeCode, runShow } from "./common.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE } from "../command.js";
import type { compile } from "../../compile.js";
import { summariseCompile } from "../../compile.js";
import { describeDraw } from "../../catalog/draw.js";
import { summarise } from "../../core/diagnostic.js";
import { formatShowTime } from "../../core/timecode.js";
import { raw } from "../../core/units.js";
import { densityReport, describeDensity } from "../../timeline/density.js";
import { describeLoad, loadReport } from "../../timeline/load.js";
import { driftReport } from "../../timeline/quantise.js";

/**
 * The command a shooter runs twenty times a day.
 *
 * It reports and does not write anything, which is what makes it safe to run
 * on a half finished script. Everything it says has to be actionable: a
 * diagnostic that a shooter cannot act on is noise, and noise here trains
 * people to ignore the output, which is the failure mode that actually gets
 * somebody hurt.
 */
export const checkCommand: Command = {
  name: "check",
  summary: "read a show and report everything wrong with it",
  usage: "check <script> [options]",
  flags: [
    ...SHOW_FLAGS,
    { name: "quiet", kind: "switch", help: "print only the verdict" },
    {
      name: "stats",
      kind: "switch",
      help: "print the timing and load numbers",
    },
  ],
  run(args, env) {
    const outcome = runShow(args, env, { quiet: args.switches.has("quiet") });
    if (outcome === undefined) {
      return EXIT_BAD_USAGE;
    }
    if (args.switches.has("stats")) {
      for (const line of statLines(outcome.result)) {
        env.out(line);
      }
    }
    env.out(summariseCompile(outcome.result));
    return outcomeCode(outcome);
  },
};

function statLines(result: ReturnType<typeof compile>): string[] {
  const lines: string[] = [];
  const schedule = result.schedule;
  lines.push(`cues        ${schedule.events.length}`);
  lines.push(`runs        ${(raw(schedule.duration) / 1000).toFixed(1)}s`);
  if (raw(result.preRoll) > 0) {
    lines.push(`pre roll    ${(raw(result.preRoll) / 1000).toFixed(1)}s`);
  }
  const first = schedule.events[0];
  if (first !== undefined) {
    lines.push(`first fire  ${formatShowTime(first.ignitionAt)}`);
  }
  const drift = driftReport(schedule);
  lines.push(
    `drift       worst ${drift.worst.toFixed(1)}ms on a ${raw(drift.frame).toFixed(1)}ms frame`,
  );
  lines.push(`density     ${describeDensity(densityReport(schedule))}`);
  if (result.draw !== undefined) {
    lines.push(`magazine    ${describeDraw(result.draw)}`);
  }
  lines.push(`diagnostics ${summarise(result.diagnostics)}`);
  return lines;
}

/** Load lines for a rig, kept apart so `check` can print them only on demand. */
export function loadLines(
  result: ReturnType<typeof compile>,
  rig: Parameters<typeof loadReport>[1],
): string[] {
  return loadReport(result.schedule, rig).map(describeLoad);
}

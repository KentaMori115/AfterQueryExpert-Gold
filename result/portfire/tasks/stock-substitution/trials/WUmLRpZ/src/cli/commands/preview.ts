import { SHOW_FLAGS, outcomeCode, runShow } from "./common.js";
import { requireNumber } from "../args.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE } from "../command.js";
import { previewChart, storyboard } from "../../sim/preview.js";
import { densityReport, describeDensity } from "../../timeline/density.js";

/**
 * What the show looks like, without a field.
 *
 * The chart answers the shape question and the storyboard answers the detail
 * question, and a designer wants both at once often enough that the default
 * prints both.
 */
export const previewCommand: Command = {
  name: "preview",
  summary: "draw the shape of a show and list what happens when",
  usage: "preview <script> [options]",
  flags: [
    ...SHOW_FLAGS,
    {
      name: "kind",
      kind: "value",
      help: "which view to print",
      choices: ["both", "chart", "storyboard"],
      fallback: "both",
    },
    {
      name: "slice",
      kind: "value",
      help: "seconds of show per chart column",
      fallback: "1",
    },
    {
      name: "width",
      kind: "value",
      help: "chart columns per row",
      fallback: "60",
    },
    {
      name: "window",
      kind: "value",
      help: "milliseconds within which shots read as one moment",
      fallback: "400",
    },
  ],
  run(args, env) {
    const outcome = runShow(args, env);
    if (outcome === undefined) {
      return EXIT_BAD_USAGE;
    }
    const { result } = outcome;

    const slice = requireNumber(args, "slice", { min: 0.001 });
    const width = requireNumber(args, "width", { min: 1, integer: true });
    const window = requireNumber(args, "window", { min: 0 });
    for (const check of [slice, width, window]) {
      if (!check.ok) {
        env.err(check.reason);
        return EXIT_BAD_USAGE;
      }
    }
    if (!slice.ok || !width.ok || !window.ok) {
      return EXIT_BAD_USAGE;
    }

    const kind = args.values.get("kind") ?? "both";
    if (kind !== "storyboard") {
      env.out(
        previewChart(result.schedule, {
          sliceMs: slice.value * 1000,
          width: width.value,
        }),
      );
    }
    if (kind === "both") {
      env.out("");
    }
    if (kind !== "chart") {
      env.out(storyboard(result.schedule, window.value));
    }
    env.out("");
    env.out(describeDensity(densityReport(result.schedule)));

    return outcomeCode(outcome);
  },
};

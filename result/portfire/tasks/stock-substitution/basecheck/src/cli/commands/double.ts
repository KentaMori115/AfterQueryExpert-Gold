import { SHOW_FLAGS, OUT_FLAG, emit, outcomeCode, runShow } from "./common.js";
import { requireNumber } from "../args.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_OK, EXIT_SHOW_PROBLEM } from "../command.js";
import { formatBag } from "../../core/diagnostic.js";
import { plural } from "../../core/text.js";
import {
  checkRedundancy,
  defaultCandidates,
  describeRedundancy,
  doubledCount,
  planRedundancy,
  redundancyCost,
} from "../../rig/redundancy.js";
import type { RedundancyRule } from "../../rig/redundancy.js";

function listOf(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Which cues get a second match, and what that costs.
 *
 * The default rule doubles anything from six inches up, and a crew that wants
 * something else says so rather than editing a constant. `--candidates` prints
 * what the rule would catch without planning anything, because the first thing
 * anybody wants is to argue with the list.
 */
export const doubleCommand: Command = {
  name: "double",
  summary: "plan a second match on the cues that carry weight",
  usage: "double <script> [options]",
  flags: [
    ...SHOW_FLAGS,
    OUT_FLAG,
    {
      name: "from",
      kind: "value",
      help: "double anything at or above this bore in millimetres",
      fallback: "150",
    },
    {
      name: "always",
      kind: "value",
      help: "effects to double, comma separated",
    },
    {
      name: "labels",
      kind: "value",
      help: "labels to double, comma separated",
    },
    { name: "never", kind: "value", help: "effects to leave alone" },
    {
      name: "candidates",
      kind: "switch",
      help: "list what the rule would catch and stop",
    },
  ],
  run(args, env) {
    const outcome = runShow(args, env, { quiet: true });
    if (outcome === undefined) {
      return EXIT_BAD_USAGE;
    }
    if (outcome.result.diagnostics.hasErrors()) {
      env.err(formatBag(outcome.result.diagnostics));
      env.err("the show does not compile, so there is nothing to double");
      return EXIT_SHOW_PROBLEM;
    }
    const from = requireNumber(args, "from", { min: 1 });
    if (!from.ok) {
      env.err(from.reason);
      return EXIT_BAD_USAGE;
    }

    const rule: RedundancyRule = {
      fromCalibreMm: from.value,
      always: listOf(args.values.get("always")),
      labels: listOf(args.values.get("labels")),
      never: listOf(args.values.get("never")),
    };

    if (args.switches.has("candidates")) {
      const names = defaultCandidates(outcome.result.assignments);
      env.out(
        names.length === 0
          ? "the default rule would double nothing in this show"
          : names.join("\n"),
      );
      return EXIT_OK;
    }

    const plans = planRedundancy(
      outcome.result.assignments,
      outcome.inputs.workspace.rig,
      rule,
    );
    const cost = redundancyCost(plans);
    const text = [
      `${plural(doubledCount(plans), "cue")} doubled, ${plural(cost.extraPins, "extra pin")}`,
      "",
      describeRedundancy(plans),
    ].join("\n");

    const wrote = emit(text, args, env, "the doubling plan");
    if (wrote !== EXIT_OK) {
      return wrote;
    }
    const diagnostics = checkRedundancy(plans);
    if (diagnostics.size > 0) {
      env.err(formatBag(diagnostics));
    }
    return outcomeCode(outcome);
  },
};

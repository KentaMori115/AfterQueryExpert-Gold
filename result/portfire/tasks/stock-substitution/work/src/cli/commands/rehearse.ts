import { OUT_FLAG, SHOW_FLAGS, emit, outcomeCode, runShow } from "./common.js";
import { requireNumber } from "../args.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_OK, EXIT_SHOW_PROBLEM } from "../command.js";
import { formatBag } from "../../core/diagnostic.js";
import { plural } from "../../core/text.js";
import {
  checkRehearsal,
  describeRehearsal,
  rehearsalPlan,
} from "../../timeline/rehearsal.js";

/**
 * The dry run, written down.
 *
 * A rehearsal with no plan is a crew standing in a field agreeing that
 * something happened. This prints what each watcher should see, so a light
 * that does not appear is a finding rather than a maybe.
 */
export const rehearseCommand: Command = {
  name: "rehearse",
  summary: "write the plan for a dry run with nothing on the wires",
  usage: "rehearse <script> [options]",
  flags: [
    ...SHOW_FLAGS,
    {
      name: "window",
      kind: "value",
      help: "milliseconds within which lights read as one event",
      fallback: "250",
    },
    OUT_FLAG,
  ],
  run(args, env) {
    const outcome = runShow(args, env, { quiet: true });
    if (outcome === undefined) {
      return EXIT_BAD_USAGE;
    }
    if (outcome.result.diagnostics.hasErrors()) {
      env.err(formatBag(outcome.result.diagnostics));
      env.err("the show does not compile, so there is nothing to rehearse");
      return EXIT_SHOW_PROBLEM;
    }
    const window = requireNumber(args, "window", { min: 0 });
    if (!window.ok) {
      env.err(window.reason);
      return EXIT_BAD_USAGE;
    }

    const plan = rehearsalPlan(
      outcome.result.schedule,
      outcome.inputs.workspace.rig,
      window.value,
    );
    const text = [
      `${plural(plan.watchers, "watcher")}, ${plural(plan.steps.length, "step")}`,
      "",
      describeRehearsal(plan),
    ].join("\n");

    const wrote = emit(text, args, env, "the rehearsal plan");
    if (wrote !== EXIT_OK) {
      return wrote;
    }

    const diagnostics = checkRehearsal(plan);
    if (diagnostics.size > 0) {
      env.err(formatBag(diagnostics));
    }
    return outcomeCode(outcome);
  },
};

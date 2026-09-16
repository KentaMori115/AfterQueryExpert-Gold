import { SHOW_FLAGS, outcomeCode, runShow } from "./common.js";
import { requireNumber } from "../args.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE } from "../command.js";
import {
  explainEvent,
  explainNeighbours,
  findEvent,
} from "../../export/explain.js";
import type { DistanceRule } from "../../safety/distance.js";

/**
 * Answering the question somebody asks on the field.
 *
 * Always the same question, always about one cue, and always in a hurry. So
 * this takes any of the three things a person might have to hand: the cue
 * number off the sheet, the pin off the module, or the label out of the
 * script.
 */
export const explainCommand: Command = {
  name: "explain",
  summary: "say why one cue fires when and where it does",
  usage: "explain <script> <cue|pin|label> [options]",
  flags: [
    ...SHOW_FLAGS,
    {
      name: "neighbours",
      kind: "switch",
      help: "also list what fires within a second of it",
    },
    {
      name: "window",
      kind: "value",
      help: "milliseconds either side counted as a neighbour",
      fallback: "1000",
    },
  ],
  run(args, env) {
    const wanted = args.positional[1];
    if (wanted === undefined) {
      env.err("name the cue to explain, by number, pin or label");
      return EXIT_BAD_USAGE;
    }
    const outcome = runShow(args, env, { quiet: true });
    if (outcome === undefined) {
      return EXIT_BAD_USAGE;
    }
    const event = findEvent(outcome.result.schedule, wanted);
    if (event === undefined) {
      env.err(`there is no cue ${wanted} in this show`);
      env.err(`the show has ${outcome.result.schedule.events.length} cues`);
      return EXIT_BAD_USAGE;
    }
    const window = requireNumber(args, "window", { min: 0 });
    if (!window.ok) {
      env.err(window.reason);
      return EXIT_BAD_USAGE;
    }

    env.out(
      explainEvent(event, outcome.result.schedule, {
        rig: outcome.inputs.workspace.rig,
        ...(args.values.get("rule") === undefined
          ? {}
          : { rule: args.values.get("rule") as DistanceRule }),
      }),
    );
    if (args.switches.has("neighbours")) {
      env.out("");
      env.out("around it");
      env.out("");
      env.out(explainNeighbours(event, outcome.result.schedule, window.value));
    }
    return outcomeCode(outcome);
  },
};

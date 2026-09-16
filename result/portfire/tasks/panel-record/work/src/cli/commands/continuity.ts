import { SHOW_FLAGS, runShow } from "./common.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_OK, EXIT_SHOW_PROBLEM } from "../command.js";
import { formatBag } from "../../core/diagnostic.js";
import { plural } from "../../core/text.js";
import { ohms } from "../../core/units.js";
import {
  checkReconciliation,
  checkResistances,
  parseContinuity,
  reconcile,
  unwalkedPins,
} from "../../rig/continuity.js";
import { leadResistance } from "../../rig/circuit.js";
import { formatPin } from "../../rig/pin.js";

/**
 * Reading the panel's own walk against the show.
 *
 * This is run on the field, twice, once when the wiring is finished and once
 * after the last person has been out among the mortars. The second run is the
 * one that matters, and it is the one people skip.
 */
export const continuityCommand: Command = {
  name: "continuity",
  summary: "check a panel's continuity walk against the show",
  usage: "continuity <script> --walk <dump.csv> [options]",
  flags: [
    ...SHOW_FLAGS,
    { name: "walk", kind: "value", help: "the panel's continuity dump" },
    {
      name: "resistance",
      kind: "switch",
      help: "also check measured resistances against the circuit",
    },
    {
      name: "unwalked",
      kind: "switch",
      help: "list rig pins the walk never reported",
    },
  ],
  run(args, env) {
    const walkPath = args.values.get("walk");
    if (walkPath === undefined) {
      env.err("continuity needs --walk, the panel's dump");
      return EXIT_BAD_USAGE;
    }
    const walkText = env.readFile(walkPath);
    if (walkText === undefined) {
      env.err(`cannot read the walk at ${walkPath}`);
      return EXIT_BAD_USAGE;
    }
    const outcome = runShow(args, env, { quiet: true });
    if (outcome === undefined) {
      return EXIT_BAD_USAGE;
    }
    if (outcome.result.diagnostics.hasErrors()) {
      env.err(formatBag(outcome.result.diagnostics));
      env.err(
        "the show does not compile, so there is nothing to check against",
      );
      return EXIT_SHOW_PROBLEM;
    }

    const walk = parseContinuity(walkText, walkPath);
    if (walk.diagnostics.size > 0) {
      env.err(formatBag(walk.diagnostics));
    }
    if (walk.diagnostics.hasErrors()) {
      return EXIT_SHOW_PROBLEM;
    }

    const expected = outcome.result.schedule.events.map(
      (event) => event.address,
    );
    const result = reconcile(expected, walk.rows);
    const diagnostics = checkReconciliation(result);

    if (args.switches.has("resistance")) {
      const settings = outcome.inputs.workspace.settings;
      diagnostics.addAll(
        checkResistances(
          walk.rows,
          settings.match,
          leadResistance(settings.leadMetres),
          settings.voltage,
        ).all(),
      );
    }

    if (diagnostics.size > 0) {
      env.err(formatBag(diagnostics));
    }
    if (args.switches.has("unwalked")) {
      const missed = unwalkedPins(outcome.inputs.workspace.rig, walk.rows);
      env.out(
        missed.length === 0
          ? "the walk covered every pin in the rig"
          : `never walked: ${missed.map(formatPin).join(" ")}`,
      );
    }

    env.out(
      [
        `${plural(walk.rows.length, "pin")} walked`,
        `${plural(expected.length, "cue")} in the show`,
        plural(result.dead.length, "dead cue"),
        plural(result.stray.length, "stray lead"),
      ].join(", "),
    );
    return diagnostics.hasErrors() ? EXIT_SHOW_PROBLEM : EXIT_OK;
  },
};

/** The lead resistance the settings imply, for a caller other than the CLI. */
export function settingsLeadResistance(metresOfLead: number) {
  return metresOfLead <= 0 ? ohms(0) : leadResistance(metresOfLead);
}

import {
  SHOW_FLAGS,
  outcomeCode,
  runShow,
  siteFor,
  windFromArgs,
} from "./common.js";
import { requireNumber } from "../args.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_SHOW_PROBLEM } from "../command.js";
import { sitePlan } from "../../export/siteplan.js";
import { sortedEntries } from "../../core/collect.js";
import { countTable } from "../../core/text.js";
import type { DistanceRule } from "../../safety/distance.js";
import {
  checkLayout,
  describeLayout,
  mixedBorePositions,
  rackNeeds,
  rackTotals,
  tubeOrder,
} from "../../rig/layout.js";
import { formatBag } from "../../core/diagnostic.js";

/**
 * The two things a crew looks at while loading the van.
 *
 * The plan says where things stand and the layout says what to put on the
 * lorry. They are separate commands because they are read by different people
 * at different times, and folding them together would mean the person doing
 * the hire order reads a picture they do not need.
 */
export const planCommand: Command = {
  name: "plan",
  summary: "draw the site with the positions and the boundaries",
  usage: "plan <script> --audience <metres> | --site <sheet> [options]",
  flags: [
    ...SHOW_FLAGS,
    { name: "width", kind: "value", help: "columns", fallback: "72" },
    { name: "height", kind: "value", help: "rows", fallback: "24" },
    { name: "rings", kind: "switch", help: "draw the separation distances" },
    {
      name: "fallout",
      kind: "switch",
      help: "draw where the fallout lands, downwind if --wind is given",
    },
  ],
  run(args, env) {
    const outcome = runShow(args, env, { quiet: true });
    if (outcome === undefined) {
      return EXIT_BAD_USAGE;
    }
    const where = siteFor(args, outcome.inputs.workspace);
    if (where === undefined) {
      env.err(
        "plan needs --audience, the metres from the origin to the line, or --site, the sheet",
      );
      return EXIT_BAD_USAGE;
    }
    const width = requireNumber(args, "width", { min: 1, integer: true });
    const height = requireNumber(args, "height", { min: 1, integer: true });
    if (!width.ok) {
      env.err(width.reason);
      return EXIT_BAD_USAGE;
    }
    if (!height.ok) {
      env.err(height.reason);
      return EXIT_BAD_USAGE;
    }
    const air = windFromArgs(args);
    env.out(
      sitePlan(outcome.inputs.workspace.rig, where, outcome.result.schedule, {
        width: width.value,
        height: height.value,
        rings: args.switches.has("rings"),
        fallout: args.switches.has("fallout"),
        ...(air === undefined ? {} : { wind: air }),
        ...(args.values.get("rule") === undefined
          ? {}
          : { rule: args.values.get("rule") as DistanceRule }),
      }),
    );
    return outcomeCode(outcome);
  },
};

/**
 * What to load onto the lorry. It reads the assignments the compile already
 * made rather than allocating again, so the racks it counts are the racks the
 * firing table fires from.
 */
export const layoutCommand: Command = {
  name: "layout",
  summary: "racks, tubes and the hire order for a show",
  usage: "layout <script> [options]",
  flags: [
    ...SHOW_FLAGS,
    {
      name: "max-racks",
      kind: "value",
      help: "racks a crew will stand in one row",
      fallback: "8",
    },
    { name: "order", kind: "switch", help: "print the tube hire order" },
  ],
  run(args, env) {
    const outcome = runShow(args, env, { quiet: true });
    if (outcome === undefined) {
      return EXIT_BAD_USAGE;
    }
    if (outcome.result.diagnostics.hasErrors()) {
      env.err(formatBag(outcome.result.diagnostics));
      env.err("the show does not compile, so the layout would be a guess");
      return EXIT_SHOW_PROBLEM;
    }
    const maxRacksCheck = requireNumber(args, "max-racks", {
      min: 1,
      integer: true,
    });
    if (!maxRacksCheck.ok) {
      env.err(maxRacksCheck.reason);
      return EXIT_BAD_USAGE;
    }
    const maxRacks = maxRacksCheck.value;

    const assignments = outcome.result.assignments;
    const needs = rackNeeds(assignments);
    env.out(describeLayout(needs));

    const totals = rackTotals(needs);
    if (totals.size > 0) {
      env.out("");
      env.out(countTable(sortedEntries(totals), ["bore", "racks"]));
    }

    if (args.switches.has("order")) {
      env.out("");
      env.out(
        countTable(sortedEntries(tubeOrder(assignments)), ["bore", "tubes"]),
      );
    }

    const mixed = mixedBorePositions(needs);
    if (mixed.size > 0) {
      env.out("");
      for (const [position, bores] of sortedEntries(mixed)) {
        env.out(
          `${position} carries ${bores.map((bore) => `${bore}mm`).join(" and ")}`,
        );
      }
    }

    const diagnostics = checkLayout(needs, { maxRacksPerPosition: maxRacks });
    if (diagnostics.size > 0) {
      env.err(formatBag(diagnostics));
    }
    return diagnostics.hasErrors() ? EXIT_SHOW_PROBLEM : outcomeCode(outcome);
  },
};

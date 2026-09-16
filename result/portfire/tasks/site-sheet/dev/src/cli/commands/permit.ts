import {
  OUT_FLAG,
  SHOW_FLAGS,
  emit,
  outcomeCode,
  runShow,
  siteFor,
  siteNameFor,
} from "./common.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_OK } from "../command.js";
import { permitDocument } from "../../export/permit.js";
import type { PermitDetails } from "../../export/permit.js";
import type { DistanceRule } from "../../safety/distance.js";

/**
 * The application.
 *
 * This needs an audience distance to say anything useful, so it refuses
 * without one rather than producing a document with a blank where the
 * separation should be. A permit application with a blank in it comes back,
 * and it comes back three weeks later.
 */
export const permitCommand: Command = {
  name: "permit",
  summary: "write the facts a licensing authority asks for",
  usage: "permit <script> --audience <metres> | --site <sheet> [options]",
  flags: [
    ...SHOW_FLAGS,
    { name: "show-name", kind: "value", help: "name of the display" },
    { name: "site-name", kind: "value", help: "name of the site" },
    { name: "date", kind: "value", help: "date of the show, as 2025-11-05" },
    { name: "operator", kind: "value", help: "who is firing it" },
    { name: "licence", kind: "value", help: "licence or registration number" },
    OUT_FLAG,
  ],
  run(args, env) {
    const outcome = runShow(args, env, { quiet: true });
    if (outcome === undefined) {
      return EXIT_BAD_USAGE;
    }
    const where = siteFor(args, outcome.inputs.workspace);
    if (where === undefined) {
      env.err(
        "permit needs --audience, the metres from the origin to the line, or --site, the sheet",
      );
      return EXIT_BAD_USAGE;
    }
    const details: PermitDetails = {
      showName: args.values.get("show-name") ?? outcome.inputs.name,
      siteName: siteNameFor(args, where),
      ...(args.values.get("date") === undefined
        ? {}
        : { date: args.values.get("date") as string }),
      ...(args.values.get("operator") === undefined
        ? {}
        : { operator: args.values.get("operator") as string }),
      ...(args.values.get("licence") === undefined
        ? {}
        : { licenceNumber: args.values.get("licence") as string }),
    };
    const rule = (args.values.get("rule") ?? "nfpa-1123") as DistanceRule;
    const document = permitDocument(
      outcome.result.schedule,
      outcome.inputs.workspace.rig,
      where,
      details,
      rule,
    );

    const wrote = emit(document, args, env, "the permit facts");
    return wrote === EXIT_OK ? outcomeCode(outcome) : wrote;
  },
};

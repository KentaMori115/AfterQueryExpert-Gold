import { requireNumber } from "../args.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_OK, EXIT_SHOW_PROBLEM } from "../command.js";
import { formatBag } from "../../core/diagnostic.js";
import { metres } from "../../core/units.js";
import {
  DENSITIES,
  capacityFor,
  checkCrowd,
  depthNeeded,
  describeCrowd,
} from "../../safety/crowd.js";
import type { CrowdDensity } from "../../safety/crowd.js";

/**
 * How many the field holds.
 *
 * This takes no script at all, which is the point. It is asked on the site
 * visit, months before anybody writes a cue, and the answer changes what show
 * can be designed. A crew that finds out in November that the field holds four
 * thousand has designed the wrong show.
 */
export const crowdCommand: Command = {
  name: "crowd",
  summary: "capacity and clearance for a viewing area",
  usage: "crowd --frontage <m> --depth <m> --expected <people>",
  flags: [
    { name: "frontage", kind: "value", help: "metres along the audience line" },
    { name: "depth", kind: "value", help: "metres back from the line" },
    { name: "expected", kind: "value", help: "people expected" },
    {
      name: "density",
      kind: "value",
      help: "how tightly people will stand",
      choices: ["seated", "comfortable", "dense", "packed"],
      fallback: "comfortable",
    },
    { name: "exits", kind: "value", help: "how many exits the area has" },
    {
      name: "rate",
      kind: "value",
      help: "people per minute one exit clears",
      fallback: "82",
    },
    {
      name: "depth-for",
      kind: "switch",
      help: "say how deep the area has to be rather than checking one",
    },
  ],
  run(args, env) {
    const frontage = requireNumber(args, "frontage", { min: 0 });
    if (!frontage.ok) {
      env.err(frontage.reason);
      return EXIT_BAD_USAGE;
    }
    const expected = requireNumber(args, "expected", { min: 0, integer: true });
    if (!expected.ok) {
      env.err(expected.reason);
      return EXIT_BAD_USAGE;
    }
    const density = (args.values.get("density") ??
      "comfortable") as CrowdDensity;

    if (args.switches.has("depth-for")) {
      const needed = depthNeeded(
        expected.value,
        metres(frontage.value),
        density,
      );
      env.out(
        Number.isFinite(needed)
          ? `${expected.value} people at ${density} need ${needed.toFixed(0)}m of depth behind ${frontage.value}m of frontage`
          : "no depth is enough behind no frontage",
      );
      return EXIT_OK;
    }

    const depth = requireNumber(args, "depth", { min: 0 });
    if (!depth.ok) {
      env.err(depth.reason);
      return EXIT_BAD_USAGE;
    }
    const rate = requireNumber(args, "rate", { min: 1 });
    if (!rate.ok) {
      env.err(rate.reason);
      return EXIT_BAD_USAGE;
    }

    const area = {
      frontage: metres(frontage.value),
      depth: metres(depth.value),
    };
    let exits: number | undefined;
    if (args.values.get("exits") !== undefined) {
      const check = requireNumber(args, "exits", { min: 0, integer: true });
      if (!check.ok) {
        env.err(check.reason);
        return EXIT_BAD_USAGE;
      }
      exits = check.value;
    }

    const plan = {
      expected: expected.value,
      area,
      density,
      exitRate: rate.value,
      ...(exits === undefined ? {} : { exits }),
    };
    env.out(describeCrowd(plan));
    env.out("");
    env.out(
      `at every density: ${(Object.keys(DENSITIES) as CrowdDensity[])
        .map((name) => `${name} ${capacityFor(area, name)}`)
        .join(", ")}`,
    );

    const diagnostics = checkCrowd(plan);
    if (diagnostics.size > 0) {
      env.err(formatBag(diagnostics));
    }
    return diagnostics.hasErrors() ? EXIT_SHOW_PROBLEM : EXIT_OK;
  },
};

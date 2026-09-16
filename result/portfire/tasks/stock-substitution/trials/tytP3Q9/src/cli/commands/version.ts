import type { Command } from "../command.js";
import { EXIT_OK } from "../command.js";
import {
  MINIMUM_NODE,
  describeVersion,
  nodeIsSupported,
  versionInfo,
} from "../../version.js";

/**
 * The first thing to ask for in a bug report, so it is one word to get.
 */
export const versionCommand: Command = {
  name: "version",
  summary: "print the build, the schema version and the runtime",
  usage: "version [options]",
  flags: [{ name: "short", kind: "switch", help: "print the version alone" }],
  run(args, env) {
    const info = versionInfo();
    if (args.switches.has("short")) {
      env.out(info.version);
      return EXIT_OK;
    }
    env.out(describeVersion(info));
    if (info.node !== "unknown" && !nodeIsSupported(info.node)) {
      env.err(
        `this node is older than ${MINIMUM_NODE}, which is the lowest tested`,
      );
    }
    return EXIT_OK;
  },
};

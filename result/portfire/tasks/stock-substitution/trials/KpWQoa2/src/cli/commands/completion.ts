import { completionFor } from "../completion.js";
import type { Shell } from "../completion.js";
import type { Command } from "../command.js";
import { EXIT_OK } from "../command.js";
import { buildCommands } from "../registry.js";

/**
 * Printing a completion script.
 *
 * It builds the command table again rather than being handed one, because a
 * command cannot see the set it belongs to and passing the set into every
 * command to serve this one would be the tail wagging the dog.
 */
export const completionCommand: Command = {
  name: "completion",
  summary: "print a shell completion script",
  usage: "completion --shell <bash|zsh>",
  flags: [
    {
      name: "shell",
      kind: "value",
      help: "which shell to write for",
      choices: ["bash", "zsh"],
      fallback: "bash",
    },
  ],
  run(args, env) {
    const shell = (args.values.get("shell") ?? "bash") as Shell;
    env.out(completionFor(buildCommands(), shell).trimEnd());
    return EXIT_OK;
  },
};

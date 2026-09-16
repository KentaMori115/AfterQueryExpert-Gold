import { buildCommands } from "./registry.js";
import { EXIT_OK, runCommand } from "./command.js";
import type { CliEnv } from "./env.js";
import { VERSION, describeVersion } from "../version.js";

/**
 * One entry point, so the binary is a shim and everything below it is
 * testable. The binary owns exactly two things the tests cannot have: the real
 * file system and the process exit code.
 */
export function main(argv: readonly string[], env: CliEnv): number {
  // `--version` before the command name, because that is where every other
  // tool puts it and because somebody asking for it has no command in mind.
  const first = argv[0];
  if (first === "--version" || first === "-v") {
    env.out(describeVersion());
    return EXIT_OK;
  }
  return runCommand(buildCommands(), argv, env);
}

/**
 * The exit code for portfire itself having gone wrong, as opposed to the show
 * having a problem or the command line being wrong. Seventy is what the BSD
 * convention calls an internal software error, and separating it matters
 * because a script that retries on a show problem must not retry on this.
 */
export const EXIT_INTERNAL = 70;

/**
 * The outermost catch.
 *
 * Nothing below here is supposed to throw, and the tests say so, but a build
 * that does anyway should not print a stack trace at somebody standing in a
 * field. It should say what happened, say that it is a bug, and say which
 * build to report against.
 */
export function runMain(argv: readonly string[], env: CliEnv): number {
  try {
    return main(argv, env);
  } catch (thrown) {
    const detail =
      thrown instanceof Error ? thrown.message : JSON.stringify(thrown);
    env.err(`portfire itself failed: ${detail}`);
    env.err(`this is a bug, report it against portfire ${VERSION}`);
    if (thrown instanceof Error && thrown.stack !== undefined) {
      env.err(thrown.stack);
    }
    return EXIT_INTERNAL;
  }
}

export { VERSION } from "../version.js";

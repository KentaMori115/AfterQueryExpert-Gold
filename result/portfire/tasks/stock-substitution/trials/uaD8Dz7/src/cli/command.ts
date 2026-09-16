import type { CliEnv } from "./env.js";
import type { FlagSpec, ParsedArgs } from "./args.js";
import { flagHelp, parseArgs } from "./args.js";
import { formatBag } from "../core/diagnostic.js";
import type { DiagnosticBag } from "../core/diagnostic.js";

/**
 * The command table.
 *
 * Exit codes matter more here than they usually do, because this runs in a
 * makefile that builds a show. Zero is a clean run, one is the show having a
 * problem, and two is the command itself being wrong. Collapsing the last two
 * would mean a typo in a flag looked exactly like a shell that will not clear
 * the audience line.
 */

export const EXIT_OK = 0;
export const EXIT_SHOW_PROBLEM = 1;
export const EXIT_BAD_USAGE = 2;

export interface Command {
  readonly name: string;
  readonly summary: string;
  /** One line of usage, without the program name. */
  readonly usage: string;
  readonly flags: readonly FlagSpec[];
  run(args: ParsedArgs, env: CliEnv): number;
}

export class CommandSet {
  private readonly commands = new Map<string, Command>();

  add(command: Command): this {
    this.commands.set(command.name, command);
    return this;
  }

  get(name: string): Command | undefined {
    return this.commands.get(name);
  }

  names(): string[] {
    return [...this.commands.keys()].sort();
  }

  all(): Command[] {
    return this.names().map((name) => {
      const command = this.commands.get(name);
      if (command === undefined) {
        throw new Error(`command ${name} vanished between listing and reading`);
      }
      return command;
    });
  }
}

export function overallHelp(commands: CommandSet): string {
  const width = commands
    .names()
    .reduce((widest, name) => Math.max(widest, name.length), 0);
  const lines = commands
    .all()
    .map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`);
  return [
    "portfire, firing scripts for computer fired displays",
    "",
    "usage: portfire <command> [options]",
    "",
    "commands:",
    ...lines,
    "",
    "run portfire help <command> for the options of one command",
  ].join("\n");
}

export function commandHelp(command: Command): string {
  const parts = [
    `portfire ${command.name}, ${command.summary}`,
    "",
    `usage: portfire ${command.usage}`,
  ];
  if (command.flags.length > 0) {
    parts.push("", "options:", flagHelp(command.flags));
  }
  return parts.join("\n");
}

export function runCommand(
  commands: CommandSet,
  argv: readonly string[],
  env: CliEnv,
): number {
  const first = argv[0];
  if (first === undefined || first === "--help" || first === "help") {
    const wanted = argv[1];
    if (wanted !== undefined) {
      const command = commands.get(wanted);
      if (command === undefined) {
        env.err(`there is no command called ${wanted}`);
        return EXIT_BAD_USAGE;
      }
      env.out(commandHelp(command));
      return EXIT_OK;
    }
    env.out(overallHelp(commands));
    return first === undefined ? EXIT_BAD_USAGE : EXIT_OK;
  }

  const command = commands.get(first);
  if (command === undefined) {
    env.err(`there is no command called ${first}`);
    env.err(`try one of ${commands.names().join(", ")}`);
    return EXIT_BAD_USAGE;
  }

  const args = parseArgs(argv.slice(1), command.flags);
  if (args.errors.length > 0) {
    for (const error of args.errors) {
      env.err(error);
    }
    env.err(commandHelp(command));
    return EXIT_BAD_USAGE;
  }
  return command.run(args, env);
}

/** Print a diagnostic bag and give back the exit code it implies. */
export function reportDiagnostics(bag: DiagnosticBag, env: CliEnv): number {
  if (bag.size > 0) {
    env.err(formatBag(bag));
  }
  return bag.hasErrors() ? EXIT_SHOW_PROBLEM : EXIT_OK;
}

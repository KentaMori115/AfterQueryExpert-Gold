#!/usr/bin/env node
import { createArena } from "../api/server.js";
import { parseArgs, printJson } from "./format.js";
import { runCommand } from "./commands/index.js";

export async function runCli(
  argv: readonly string[],
  write: (text: string) => void = (text) => {
    process.stdout.write(text);
  },
): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.command === "help" || parsed.flags.help === "true") {
    write(`arenaflow <command> [--flag value]

Commands:
  help
  player:create
  tournament:create
  tournament:open
  tournament:register
  tournament:start
  tournament:end
  match:create
  match:result
  leaderboard
  rewards:distribute
`);
    return 0;
  }
  try {
    const { service } = createArena();
    const result = await runCommand(parsed.command, parsed.flags, service);
    write(printJson(result));
    return 0;
  } catch (error) {
    write(printJson({ error: error instanceof Error ? error.message : String(error) }));
    return 1;
  }
}

const isMain = process.argv[1]?.includes("cli");
if (isMain) {
  void runCli(process.argv.slice(2)).then((code) => process.exit(code));
}

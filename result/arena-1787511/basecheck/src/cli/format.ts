export function printJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function parseArgs(argv: readonly string[]): { command: string; flags: Record<string, string> } {
  const [command = "help", ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = "true";
    }
  }
  return { command, flags };
}

export function requiredFlag(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (!value) {
    throw new Error(`missing --${name}`);
  }
  return value;
}

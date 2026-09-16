export class UsageError extends Error {
  public override readonly name = "UsageError";
}

export type GlobalOptions = {
  readonly root: string;
  readonly format: "text" | "json" | "csv" | "markdown";
};

export function parseArgs(argv: readonly string[]): {
  readonly command: readonly string[];
  readonly options: GlobalOptions;
} {
  const command: string[] = [];
  let root = process.cwd();
  let format: GlobalOptions["format"] = "text";
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--root") {
      const value = argv[index + 1];
      if (!value) {
        throw new UsageError("--root requires a path");
      }
      root = value;
      index += 1;
      continue;
    }
    if (token === "--format") {
      const value = argv[index + 1];
      if (value !== "text" && value !== "json" && value !== "csv" && value !== "markdown") {
        throw new UsageError("--format must be text, json, csv, or markdown");
      }
      format = value;
      index += 1;
      continue;
    }
    if (token === "--ticks") {
      command.push(token);
      const value = argv[index + 1];
      if (!value) {
        throw new UsageError("--ticks requires a number");
      }
      command.push(value);
      index += 1;
      continue;
    }
    if (token === "--species" || token === "--tick") {
      command.push(token);
      const value = argv[index + 1];
      if (!value) {
        throw new UsageError(`${token} requires a value`);
      }
      command.push(value);
      index += 1;
      continue;
    }
    if (token?.startsWith("--")) {
      throw new UsageError(`unknown option ${token}`);
    }
    if (token) {
      command.push(token);
    }
  }
  return { command, options: { root, format } };
}

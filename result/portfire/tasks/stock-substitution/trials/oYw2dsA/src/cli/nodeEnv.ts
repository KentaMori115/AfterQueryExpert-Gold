import { readFileSync, writeFileSync } from "node:fs";
import type { CliEnv } from "./env.js";

/**
 * The real world. A read that fails gives nothing rather than throwing,
 * because every caller wants to report a missing file as a diagnostic rather
 * than as a stack trace, and a stack trace on a laptop in a field is not
 * information.
 */
export class NodeEnv implements CliEnv {
  readonly cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  readFile(path: string): string | undefined {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  }

  writeFile(path: string, text: string): boolean {
    try {
      writeFileSync(path, text, "utf8");
      return true;
    } catch {
      return false;
    }
  }

  out(text: string): void {
    process.stdout.write(`${text}\n`);
  }

  err(text: string): void {
    process.stderr.write(`${text}\n`);
  }
}

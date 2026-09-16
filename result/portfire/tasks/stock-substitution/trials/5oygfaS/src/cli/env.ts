import type { Magazine } from "../catalog/inventory.js";
import { parseMagazine } from "../catalog/magazine.js";
import { Catalog } from "../catalog/registry.js";
import { parseCatalog } from "../catalog/parse.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { parseRig } from "../rig/parse.js";
import type { RigSettings } from "../rig/parse.js";
import { Rig } from "../rig/rig.js";

/**
 * Everything the commands are allowed to touch outside themselves.
 *
 * Reading and writing go through this rather than through the node modules
 * directly, which is what makes the commands testable without a temporary
 * directory. It is a small interface on purpose. A command that wanted more
 * than reading a file and writing some text would be doing something the CLI
 * should not be doing.
 */

export interface CliEnv {
  /** File contents, or nothing when it is not there or not readable. */
  readFile(path: string): string | undefined;
  writeFile(path: string, text: string): boolean;
  out(text: string): void;
  err(text: string): void;
  /** Working directory, for resolving a relative path in an include. */
  readonly cwd: string;
}

export interface Workspace {
  readonly catalog: Catalog;
  readonly rig: Rig;
  /**
   * Only there when a book was named. An empty magazine and no magazine are
   * different answers: one says the store is empty, the other says nobody
   * asked about the store.
   */
  readonly magazine?: Magazine;
  readonly settings: RigSettings;
  readonly diagnostics: DiagnosticBag;
}

/**
 * Load the catalog, the rig and the magazine book a command needs. All three
 * are optional, because some commands do useful work with none of them, and a
 * missing file is a diagnostic rather than a throw so the caller can report it
 * in the same shape as everything else.
 */
export function loadWorkspace(
  env: CliEnv,
  paths: {
    readonly catalog?: string;
    readonly rig?: string;
    readonly magazine?: string;
  },
): Workspace {
  const diagnostics = new DiagnosticBag();
  let catalog = new Catalog();
  let rig = new Rig();
  let settings: RigSettings | undefined;
  let magazine: Magazine | undefined;

  if (paths.catalog !== undefined) {
    const text = env.readFile(paths.catalog);
    if (text === undefined) {
      diagnostics.error({
        code: "PF5000",
        message: `cannot read the catalog at ${paths.catalog}`,
      });
    } else {
      const parsed = parseCatalog(text, paths.catalog);
      catalog = parsed.catalog;
      diagnostics.addAll(parsed.diagnostics.all());
    }
  }

  if (paths.magazine !== undefined) {
    const text = env.readFile(paths.magazine);
    if (text === undefined) {
      diagnostics.error({
        code: "PF5002",
        message: `cannot read the magazine book at ${paths.magazine}`,
      });
    } else {
      const parsed = parseMagazine(text, paths.magazine);
      magazine = parsed.magazine;
      diagnostics.addAll(parsed.diagnostics.all());
    }
  }

  if (paths.rig !== undefined) {
    const text = env.readFile(paths.rig);
    if (text === undefined) {
      diagnostics.error({
        code: "PF5001",
        message: `cannot read the rig sheet at ${paths.rig}`,
      });
    } else {
      const parsed = parseRig(text, paths.rig);
      rig = parsed.rig;
      settings = parsed.settings;
      diagnostics.addAll(parsed.diagnostics.all());
    }
  }

  return {
    catalog,
    rig,
    ...(magazine === undefined ? {} : { magazine }),
    settings: settings ?? fallbackSettings(),
    diagnostics,
  };
}

function fallbackSettings(): RigSettings {
  const parsed = parseRig("", "(none)");
  return parsed.settings;
}

/** A recording environment, for tests and for a dry run. */
export class MemoryEnv implements CliEnv {
  readonly written = new Map<string, string>();
  readonly output: string[] = [];
  readonly errors: string[] = [];
  readonly cwd: string;
  private readonly files: Map<string, string>;

  constructor(files: Record<string, string> = {}, cwd = "/show") {
    this.files = new Map(Object.entries(files));
    this.cwd = cwd;
  }

  readFile(path: string): string | undefined {
    return this.files.get(path) ?? this.written.get(path);
  }

  writeFile(path: string, text: string): boolean {
    this.written.set(path, text);
    return true;
  }

  out(text: string): void {
    this.output.push(text);
  }

  err(text: string): void {
    this.errors.push(text);
  }

  /** Everything written to standard output, joined, for an assertion. */
  get stdout(): string {
    return this.output.join("\n");
  }

  get stderr(): string {
    return this.errors.join("\n");
  }
}

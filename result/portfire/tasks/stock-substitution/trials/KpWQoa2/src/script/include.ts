import type { Script, Statement } from "./ast.js";
import { parseScript } from "./parser.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { buildAdjacency, findCycle } from "../core/graph.js";
import { SourceFile } from "../core/span.js";

/**
 * Pulling a show together from several files.
 *
 * A show of any size is not one file. The opening, the body and the finale get
 * written by different people on different evenings, and the library of
 * ripples and chases is shared between shows. So a script can include another,
 * and the loader has to cope with the same file being included twice and with
 * two files including each other.
 *
 * Including a file twice is fine and the second include is skipped, the same
 * way a header guard works. Two files including each other is not fine and is
 * reported with the whole loop, because a shooter looking at a cycle needs to
 * see which edge to cut.
 */

export interface FileReader {
  /** Contents of a path, or nothing when it cannot be read. */
  (path: string): string | undefined;
}

export interface LoadedScript {
  readonly script: Script;
  readonly diagnostics: DiagnosticBag;
  /** Every file that went into the show, in the order they were read. */
  readonly files: readonly string[];
}

/**
 * Resolve an include path against the file that named it. Only a relative walk
 * is supported, because an absolute path in a show script does not survive
 * being handed to another crew.
 */
export function resolveInclude(from: string, path: string): string {
  if (path.startsWith("/")) {
    return path;
  }
  const parts = from.split("/");
  parts.pop();
  for (const piece of path.split("/")) {
    if (piece === "." || piece.length === 0) {
      continue;
    }
    if (piece === "..") {
      parts.pop();
      continue;
    }
    parts.push(piece);
  }
  return parts.join("/");
}

export function loadScript(entry: string, read: FileReader): LoadedScript {
  const diagnostics = new DiagnosticBag();
  const statements: Statement[] = [];
  const files: string[] = [];
  const loaded = new Set<string>();
  const edges: [string, string][] = [];
  const stack: string[] = [];

  const walk = (path: string): void => {
    if (loaded.has(path)) {
      return;
    }
    if (stack.includes(path)) {
      // The graph below reports the loop properly, so this only stops the
      // recursion rather than being the diagnostic.
      return;
    }
    const text = read(path);
    if (text === undefined) {
      diagnostics.error({
        code: "PF2500",
        message: `cannot read ${path}`,
        ...(stack.length === 0
          ? {}
          : { help: `included from ${stack[stack.length - 1] ?? ""}` }),
      });
      return;
    }
    loaded.add(path);
    files.push(path);
    stack.push(path);
    const file = new SourceFile(path, text);
    const parsed = parseScript(file);
    diagnostics.addAll(parsed.diagnostics.all());
    for (const statement of parsed.script.statements) {
      if (statement.kind === "include") {
        const target = resolveInclude(path, statement.path);
        edges.push([path, target]);
        walk(target);
        continue;
      }
      statements.push(statement);
    }
    stack.pop();
  };

  walk(entry);

  const cycle = findCycle(buildAdjacency(edges));
  if (cycle !== undefined) {
    diagnostics.error({
      code: "PF2501",
      message: `these files include each other, ${cycle.join(" -> ")}`,
      help: "cut one of those includes, a show cannot be built from a loop",
    });
  }

  return {
    script: { source: entry, statements },
    diagnostics,
    files,
  };
}

/** Every path an entry file reaches, without loading the statements. */
export function includedFiles(
  entry: string,
  read: FileReader,
): readonly string[] {
  return loadScript(entry, read).files;
}

/**
 * Two groups with the same name coming from different files. The later one
 * wins at expansion time, which is almost never what was meant.
 */
export function duplicateGroups(script: Script): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const statement of script.statements) {
    if (statement.kind !== "group") {
      continue;
    }
    if (seen.has(statement.name)) {
      twice.add(statement.name);
    }
    seen.add(statement.name);
  }
  return [...twice].sort();
}

export function checkDuplicateGroups(script: Script): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const name of duplicateGroups(script)) {
    diagnostics.error({
      code: "PF2502",
      message: `there are two groups called ${name}`,
      help: "rename one, a play can only reach the last of them",
    });
  }
  return diagnostics;
}

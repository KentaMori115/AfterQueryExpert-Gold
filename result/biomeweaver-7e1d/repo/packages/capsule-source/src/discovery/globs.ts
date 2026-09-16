import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { compareLogicalPaths, logicalPathFromAbsolute, toLogicalPath } from "./paths.js";

const AUTHED_EXTENSIONS = new Set([".yaml", ".yml", ".json"]);

export function globToRegExp(pattern: string): RegExp {
  const logical = toLogicalPath(pattern);
  let source = "^";
  for (let i = 0; i < logical.length; i += 1) {
    const char = logical[i];
    if (char === "*" && logical[i + 1] === "*") {
      const next = logical[i + 2];
      if (next === "/") {
        source += "(?:.*/)?";
        i += 2;
        continue;
      }
      source += ".*";
      i += 1;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    if (char !== undefined && /[.+^${}()|[\]\\]/.test(char)) {
      source += `\\${char}`;
      continue;
    }
    source += char ?? "";
  }
  source += "$";
  return new RegExp(source);
}

export function matchesGlob(logicalPath: string, pattern: string): boolean {
  return globToRegExp(pattern).test(toLogicalPath(logicalPath));
}

function walkFiles(root: string, directory: string, files: string[]): void {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".biomeweaver" || entry.name === "node_modules") {
        continue;
      }
      walkFiles(root, absolute, files);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    files.push(absolute);
  }
}

export function listAuthoredFiles(root: string): string[] {
  const files: string[] = [];
  walkFiles(root, root, files);
  return files
    .filter((absolute) => {
      const logical = logicalPathFromAbsolute(root, absolute);
      return AUTHED_EXTENSIONS.has(extensionOf(logical));
    })
    .sort((left, right) =>
      compareLogicalPaths(
        logicalPathFromAbsolute(root, left),
        logicalPathFromAbsolute(root, right),
      ),
    );
}

export function expandIncludePatterns(root: string, patterns: readonly string[]): string[] {
  const files = listAuthoredFiles(root);
  const matched = new Set<string>();
  for (const pattern of patterns) {
    for (const absolute of files) {
      const logical = logicalPathFromAbsolute(root, absolute);
      if (matchesGlob(logical, pattern)) {
        matched.add(logical);
      }
    }
  }
  return [...matched].sort(compareLogicalPaths);
}

export function extensionOf(logicalPath: string): string {
  const slash = logicalPath.lastIndexOf("/");
  const name = slash === -1 ? logicalPath : logicalPath.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

export function isAuthoredFile(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}

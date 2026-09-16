import type { IncludeGroup } from "../types.js";
import { validateDiscoveredFiles, validateIncludePatterns } from "./containment.js";
import { expandIncludePatterns } from "./globs.js";
import { INCLUDE_GROUPS, readManifest } from "./manifest.js";
import type { CapsuleManifest } from "../types.js";
import type { Diagnostic } from "../types.js";

export type DiscoveredFile = {
  readonly path: string;
  readonly group: IncludeGroup;
};

export type DiscoveryResult = {
  readonly manifest?: CapsuleManifest;
  readonly files: readonly DiscoveredFile[];
  readonly diagnostics: readonly Diagnostic[];
};

export function discoverAuthoredFiles(root: string): DiscoveryResult {
  const manifestRead = readManifest(root);
  if (!manifestRead.manifest) {
    return { files: [], diagnostics: manifestRead.diagnostics };
  }

  const files: DiscoveredFile[] = [];
  const diagnostics = [...manifestRead.diagnostics];
  for (const group of INCLUDE_GROUPS) {
    const patterns = manifestRead.manifest.include[group];
    diagnostics.push(...validateIncludePatterns(patterns, group));
    for (const path of expandIncludePatterns(root, patterns)) {
      files.push({ path, group });
    }
  }

  files.sort(
    (left, right) => left.path.localeCompare(right.path) || left.group.localeCompare(right.group),
  );
  diagnostics.push(...validateDiscoveredFiles(root, files));
  return {
    manifest: manifestRead.manifest,
    files,
    diagnostics,
  };
}

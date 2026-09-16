import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { DiagnosticCode } from "../diagnostics/codes.js";
import { diagnostic } from "../diagnostics/diagnostic.js";
import { sourceLocation } from "../location/source-location.js";
import type { Diagnostic, IncludeGroup } from "../types.js";
import type { DiscoveredFile } from "./discover.js";
import { MANIFEST_NAME } from "./manifest.js";
import { isOutsideRootAttempt, resolveInsideRoot } from "./paths.js";

export function validateIncludePatterns(
  patterns: readonly string[],
  group: IncludeGroup,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const pattern of patterns) {
    if (isOutsideRootAttempt(pattern)) {
      diagnostics.push(
        diagnostic(
          DiagnosticCode.PATH_ESCAPE,
          "error",
          `include pattern in ${group} escapes the capsule: ${pattern}`,
          sourceLocation(MANIFEST_NAME),
        ),
      );
    }
  }
  return diagnostics;
}

export function validateDiscoveredFiles(
  root: string,
  files: readonly DiscoveredFile[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Map<string, IncludeGroup>();

  for (const file of files) {
    if (isOutsideRootAttempt(file.path)) {
      diagnostics.push(
        diagnostic(
          DiagnosticCode.PATH_ESCAPE,
          "error",
          `authored path escapes the capsule: ${file.path}`,
          sourceLocation(file.path),
        ),
      );
      continue;
    }

    try {
      const absolute = resolveInsideRoot(root, file.path);
      const realRoot = realpathSync(resolve(root));
      const realFile = realpathSync(absolute);
      const rel = relative(realRoot, realFile);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        diagnostics.push(
          diagnostic(
            DiagnosticCode.PATH_ESCAPE,
            "error",
            `authored path resolves outside the capsule: ${file.path}`,
            sourceLocation(file.path),
          ),
        );
        continue;
      }
    } catch {
      diagnostics.push(
        diagnostic(
          DiagnosticCode.PATH_ESCAPE,
          "error",
          `authored path is not contained by the capsule: ${file.path}`,
          sourceLocation(file.path),
        ),
      );
      continue;
    }

    const previous = seen.get(file.path);
    if (previous !== undefined) {
      diagnostics.push(
        diagnostic(
          DiagnosticCode.DUPLICATE_PATH,
          "error",
          `logical path ${file.path} is included by both ${previous} and ${file.group}`,
          sourceLocation(file.path),
        ),
      );
      continue;
    }
    seen.set(file.path, file.group);
  }

  return diagnostics;
}

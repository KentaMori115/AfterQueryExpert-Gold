import { isAbsolute, relative, resolve, sep } from "node:path";
import type { LogicalPath } from "../types.js";

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;

export function toLogicalPath(value: string): LogicalPath {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function normalizeLogicalPath(value: string): LogicalPath {
  const logical = toLogicalPath(value);
  const parts: string[] = [];
  for (const part of logical.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

export function isOutsideRootAttempt(value: string): boolean {
  const logical = toLogicalPath(value);
  if (isAbsolute(value) || WINDOWS_DRIVE.test(value) || logical.startsWith("/")) {
    return true;
  }
  const parts = logical.split("/");
  let depth = 0;
  for (const part of parts) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      depth -= 1;
      if (depth < 0) {
        return true;
      }
      continue;
    }
    depth += 1;
  }
  return false;
}

export function resolveInsideRoot(root: string, logicalPath: LogicalPath): string {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, logicalPath.split("/").join(sep));
  const rel = relative(absoluteRoot, absolutePath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`path escapes workspace root: ${logicalPath}`);
  }
  return absolutePath;
}

export function logicalPathFromAbsolute(root: string, absolutePath: string): LogicalPath {
  const absoluteRoot = resolve(root);
  const rel = relative(absoluteRoot, resolve(absolutePath));
  return toLogicalPath(rel);
}

export function compareLogicalPaths(a: LogicalPath, b: LogicalPath): number {
  return normalizeLogicalPath(a).localeCompare(normalizeLogicalPath(b));
}

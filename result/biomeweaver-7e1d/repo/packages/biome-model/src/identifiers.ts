import { diagnostic, sourceLocation, type Diagnostic } from "@biomeweaver/capsule-source";

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export function isIdentifier(value: string): boolean {
  return ID_PATTERN.test(value);
}

export function requireIdentifier(
  value: string,
  field: string,
  path: string,
  diagnostics: Diagnostic[],
): string | undefined {
  if (!isIdentifier(value)) {
    diagnostics.push(
      diagnostic(
        "BW-ID-001",
        "error",
        `${field} must be a lowercase hyphenated identifier: ${value}`,
        sourceLocation(path),
      ),
    );
    return undefined;
  }
  return value;
}

export function cohortKey(species: string, stage: string, region: string): string {
  return `${species}:${stage}:${region}`;
}

export function poolKey(resource: string, region: string): string {
  return `${resource}:${region}`;
}

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DiagnosticCode } from "../diagnostics/codes.js";
import { diagnostic } from "../diagnostics/diagnostic.js";
import { sourceLocation } from "../location/source-location.js";
import type { CapsuleManifest, Diagnostic, IncludeGroup } from "../types.js";
import { parseYamlDocument } from "../yaml/parse-yaml.js";

export const MANIFEST_NAME = "biomeweaver.yaml";

export const INCLUDE_GROUPS: readonly IncludeGroup[] = [
  "regions",
  "habitats",
  "species",
  "resources",
  "calendars",
  "scenarios",
  "events",
];

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function includePatterns(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  return asStringArray(value);
}

export function decodeManifest(data: unknown): CapsuleManifest | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  const includeRaw =
    typeof record["include"] === "object" && record["include"] !== null
      ? (record["include"] as Record<string, unknown>)
      : {};
  const precisionRaw =
    typeof record["precision"] === "object" && record["precision"] !== null
      ? (record["precision"] as Record<string, unknown>)
      : {};
  if (typeof record["biome"] !== "string" || typeof record["displayName"] !== "string") {
    return undefined;
  }
  if (typeof record["calendar"] !== "string" || typeof record["defaultScenario"] !== "string") {
    return undefined;
  }
  if (precisionRaw["rounding"] !== "half-even") {
    return undefined;
  }
  const scale = precisionRaw["scale"];
  return {
    biome: record["biome"],
    displayName: record["displayName"],
    calendar: record["calendar"],
    defaultScenario: record["defaultScenario"],
    include: {
      regions: includePatterns(includeRaw["regions"]),
      habitats: includePatterns(includeRaw["habitats"]),
      species: includePatterns(includeRaw["species"]),
      resources: includePatterns(includeRaw["resources"]),
      calendars: includePatterns(includeRaw["calendars"]),
      scenarios: includePatterns(includeRaw["scenarios"]),
      events: includePatterns(includeRaw["events"]),
    },
    precision: {
      scale:
        typeof scale === "number" ? String(scale) : typeof scale === "string" ? scale : "1000000",
      rounding: "half-even",
    },
  };
}

export function readManifest(root: string): {
  readonly manifest?: CapsuleManifest;
  readonly diagnostics: readonly Diagnostic[];
} {
  const absolute = join(root, MANIFEST_NAME);
  if (!existsSync(absolute)) {
    return {
      diagnostics: [
        diagnostic(
          DiagnosticCode.MISSING_MANIFEST,
          "error",
          `missing ${MANIFEST_NAME} in the capsule root`,
          sourceLocation(MANIFEST_NAME),
        ),
      ],
    };
  }
  const parsed = parseYamlDocument(MANIFEST_NAME, readFileSync(absolute, "utf8"));
  if (parsed.diagnostics.length > 0) {
    return { diagnostics: parsed.diagnostics };
  }
  const manifest = decodeManifest(parsed.data);
  if (!manifest) {
    return {
      diagnostics: [
        diagnostic(
          DiagnosticCode.INVALID_MANIFEST,
          "error",
          "biomeweaver.yaml is missing required biome, calendar, or precision fields",
          sourceLocation(MANIFEST_NAME),
        ),
      ],
    };
  }
  return { manifest, diagnostics: [] };
}

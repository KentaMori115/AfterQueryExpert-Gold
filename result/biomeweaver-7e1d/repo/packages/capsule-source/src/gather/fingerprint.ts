import type { AuthoredDocument, CapsuleManifest } from "../types.js";
import { canonicalStringify, sha256Text } from "./digest.js";

export const BIOMEWEAVER_VERSION = "0.1.0";

function canonicalManifest(manifest: CapsuleManifest): unknown {
  return {
    biome: manifest.biome,
    calendar: manifest.calendar,
    defaultScenario: manifest.defaultScenario,
    displayName: manifest.displayName,
    include: {
      calendars: [...manifest.include.calendars].sort(),
      events: [...manifest.include.events].sort(),
      habitats: [...manifest.include.habitats].sort(),
      regions: [...manifest.include.regions].sort(),
      resources: [...manifest.include.resources].sort(),
      scenarios: [...manifest.include.scenarios].sort(),
      species: [...manifest.include.species].sort(),
    },
    precision: {
      rounding: manifest.precision.rounding,
      scale: manifest.precision.scale,
    },
  };
}

export function workspaceFingerprint(
  manifest: CapsuleManifest,
  documents: readonly AuthoredDocument[],
): string {
  const payload = {
    documents: documents
      .map((document) => ({
        group: document.group,
        path: document.path,
        sha256: sha256Text(document.text),
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    manifest: canonicalManifest(manifest),
    version: BIOMEWEAVER_VERSION,
  };
  return sha256Text(canonicalStringify(payload));
}

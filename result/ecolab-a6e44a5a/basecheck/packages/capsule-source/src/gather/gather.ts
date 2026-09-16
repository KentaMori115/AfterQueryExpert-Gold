import { readFileSync } from "node:fs";
import { DiagnosticCode } from "../diagnostics/codes.js";
import { compareDiagnostics, diagnostic, hasErrorDiagnostics } from "../diagnostics/diagnostic.js";
import { discoverAuthoredFiles } from "../discovery/discover.js";
import { extensionOf } from "../discovery/globs.js";
import { resolveInsideRoot } from "../discovery/paths.js";
import { parseJsonDocument } from "../json/parse-json.js";
import { sourceLocation } from "../location/source-location.js";
import type {
  AuthoredDocument,
  Capsule,
  CapsuleManifest,
  Diagnostic,
  GatheredCapsule,
} from "../types.js";
import { parseYamlDocument } from "../yaml/parse-yaml.js";
import { workspaceFingerprint } from "./fingerprint.js";

const EMPTY_MANIFEST: CapsuleManifest = {
  biome: "",
  displayName: "",
  calendar: "",
  defaultScenario: "",
  include: {
    regions: [],
    habitats: [],
    species: [],
    resources: [],
    calendars: [],
    scenarios: [],
    events: [],
  },
  precision: {
    scale: "1000000",
    rounding: "half-even",
  },
};

function parseAuthored(path: string, text: string) {
  const extension = extensionOf(path);
  if (extension === ".json") {
    return parseJsonDocument(path, text);
  }
  if (extension === ".yaml" || extension === ".yml") {
    return parseYamlDocument(path, text);
  }
  return {
    data: undefined,
    location: sourceLocation(path),
    diagnostics: [
      diagnostic(
        DiagnosticCode.UNSUPPORTED_EXTENSION,
        "error",
        `unsupported authored extension ${extension || "(none)"}`,
        sourceLocation(path),
      ),
    ],
  };
}

export function gatherCapsule(capsule: Capsule): GatheredCapsule {
  const discovered = discoverAuthoredFiles(capsule.root);
  const diagnostics: Diagnostic[] = [...discovered.diagnostics];
  const documents: AuthoredDocument[] = [];

  if (!discovered.manifest) {
    return {
      root: capsule.root,
      manifest: EMPTY_MANIFEST,
      documents: [],
      diagnostics: diagnostics.sort(compareDiagnostics),
      fingerprint: "",
    };
  }

  for (const file of discovered.files) {
    const absolute = resolveInsideRoot(capsule.root, file.path);
    const text = readFileSync(absolute, "utf8");
    const parsed = parseAuthored(file.path, text);
    diagnostics.push(...parsed.diagnostics);
    documents.push({
      path: file.path,
      group: file.group,
      text,
      data: parsed.data,
      location: parsed.location,
    });
  }

  documents.sort((left, right) => left.path.localeCompare(right.path));
  return {
    root: capsule.root,
    manifest: discovered.manifest,
    documents,
    diagnostics: diagnostics.sort(compareDiagnostics),
    fingerprint: hasErrorDiagnostics(diagnostics)
      ? ""
      : workspaceFingerprint(discovered.manifest, documents),
  };
}

export { hasErrorDiagnostics };

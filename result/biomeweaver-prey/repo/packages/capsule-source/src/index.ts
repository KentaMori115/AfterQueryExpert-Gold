export { DiagnosticCode } from "./diagnostics/codes.js";
export { compareDiagnostics, diagnostic, hasErrorDiagnostics } from "./diagnostics/diagnostic.js";
export { discoverAuthoredFiles } from "./discovery/discover.js";
export type { DiscoveredFile, DiscoveryResult } from "./discovery/discover.js";
export { expandIncludePatterns, matchesGlob } from "./discovery/globs.js";
export {
  INCLUDE_GROUPS,
  MANIFEST_NAME,
  decodeManifest,
  readManifest,
} from "./discovery/manifest.js";
export { isOutsideRootAttempt, resolveInsideRoot, toLogicalPath } from "./discovery/paths.js";
export { canonicalStringify, sha256Text } from "./gather/digest.js";
export { BIOMEWEAVER_VERSION, workspaceFingerprint } from "./gather/fingerprint.js";
export { gatherCapsule } from "./gather/gather.js";
export { parseJsonDocument } from "./json/parse-json.js";
export { compareLocations, formatLocation, sourceLocation } from "./location/source-location.js";
export type {
  AuthoredDocument,
  Capsule,
  CapsuleManifest,
  Diagnostic,
  DiagnosticSeverity,
  GatheredCapsule,
  IncludeGroup,
  LogicalPath,
  SourceDigest,
  SourceLocation,
} from "./types.js";
export { parseYamlDocument } from "./yaml/parse-yaml.js";

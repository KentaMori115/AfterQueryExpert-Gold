/**
 * What this build is.
 *
 * A bug report from a field says "portfire wrote a bad table" and nothing
 * else. The one thing that makes such a report usable is knowing which build
 * wrote it, so the version is a value in the library rather than something
 * read out of package.json at runtime, which does not survive bundling.
 *
 * The schema version is separate and moves on its own. It changes when a file
 * portfire writes changes shape, which is far less often than the code does.
 */

export const VERSION = "0.1.0";

/** Version of the show json, which anything parsing that file pins. */
export const SCHEMA_VERSION = 1;

/** The lowest node this is tested against. */
export const MINIMUM_NODE = "20.11";

export interface VersionInfo {
  readonly version: string;
  readonly schema: number;
  readonly node: string;
  readonly platform: string;
}

export function versionInfo(): VersionInfo {
  return {
    version: VERSION,
    schema: SCHEMA_VERSION,
    node: typeof process === "undefined" ? "unknown" : process.versions.node,
    platform: typeof process === "undefined" ? "unknown" : process.platform,
  };
}

export function describeVersion(info: VersionInfo = versionInfo()): string {
  return [
    `portfire ${info.version}`,
    `show schema ${info.schema}`,
    `node ${info.node} on ${info.platform}`,
  ].join("\n");
}

/**
 * Compare two dotted versions. Returns a negative number when the first is
 * older, which is the shape every sort wants.
 */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10));
  const right = b.split(".").map((part) => Number.parseInt(part, 10));
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const one = left[i] ?? 0;
    const two = right[i] ?? 0;
    if (Number.isNaN(one) || Number.isNaN(two)) {
      return a < b ? -1 : a > b ? 1 : 0;
    }
    if (one !== two) {
      return one - two;
    }
  }
  return 0;
}

/** Whether the running node is new enough for this build. */
export function nodeIsSupported(version: string): boolean {
  return compareVersions(version, MINIMUM_NODE) >= 0;
}

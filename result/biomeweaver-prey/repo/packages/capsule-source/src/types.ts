export type LogicalPath = string;

export type DiagnosticSeverity = "error" | "warning" | "info";

export type SourceLocation = {
  readonly path: LogicalPath;
  readonly line: number;
  readonly column: number;
};

export type Diagnostic = {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly location?: SourceLocation;
};

export type IncludeGroup =
  "regions" | "habitats" | "species" | "resources" | "calendars" | "scenarios" | "events";

export type CapsuleManifest = {
  readonly biome: string;
  readonly displayName: string;
  readonly calendar: string;
  readonly defaultScenario: string;
  readonly include: Readonly<Record<IncludeGroup, readonly string[]>>;
  readonly precision: {
    readonly scale: string;
    readonly rounding: "half-even";
  };
};

export type AuthoredDocument = {
  readonly path: LogicalPath;
  readonly group: IncludeGroup | "manifest";
  readonly text: string;
  readonly data: unknown;
  readonly location: SourceLocation;
};

export type SourceDigest = {
  readonly algorithm: "sha256";
  readonly digest: string;
};

export type Capsule = {
  readonly root: string;
};

export type GatheredCapsule = {
  readonly root: string;
  readonly manifest: CapsuleManifest;
  readonly documents: readonly AuthoredDocument[];
  readonly diagnostics: readonly Diagnostic[];
  readonly fingerprint: string;
};

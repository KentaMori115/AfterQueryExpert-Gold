import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalStringify, sha256Text } from "@biomeweaver/capsule-source";
import type { AttributedFlow } from "@biomeweaver/flow-explanations";
import type { TickState } from "@biomeweaver/tick-runtime";

export type RunManifest = {
  readonly runId: string;
  readonly scenario: string;
  readonly fingerprint: string;
  readonly ticks: number;
  readonly digest: string;
};

export type StoredRun = {
  readonly manifest: RunManifest;
  readonly states: readonly TickState[];
  readonly flows: readonly AttributedFlow[];
};

function runDir(root: string, runId: string): string {
  return join(root, ".biomeweaver", "runs", runId);
}

export function writeRun(root: string, run: StoredRun): void {
  const directory = runDir(root, run.manifest.runId);
  mkdirSync(join(directory, "snapshots"), { recursive: true });
  writeFileSync(join(directory, "manifest.json"), `${JSON.stringify(run.manifest, null, 2)}\n`);
  writeFileSync(join(directory, "flows.json"), `${canonicalStringify(run.flows)}\n`);
  for (const state of run.states) {
    if (state.tick % 10 === 0 || state.tick === run.states[run.states.length - 1]?.tick) {
      writeFileSync(
        join(directory, "snapshots", `${String(state.tick).padStart(6, "0")}.json`),
        `${canonicalStringify(state)}\n`,
      );
    }
  }
}

export function readRun(root: string, runId: string): StoredRun {
  const directory = runDir(root, runId);
  const manifest = JSON.parse(
    readFileSync(join(directory, "manifest.json"), "utf8"),
  ) as RunManifest;
  const flows = JSON.parse(readFileSync(join(directory, "flows.json"), "utf8")) as AttributedFlow[];
  return { manifest, flows, states: [] };
}

export function verifyRun(
  root: string,
  runId: string,
): { readonly ok: boolean; readonly digest: string } {
  const stored = readRun(root, runId);
  const digest = runDigest(
    stored.manifest.scenario,
    stored.manifest.fingerprint,
    stored.manifest.ticks,
    stored.flows,
  );
  return { ok: digest === stored.manifest.digest, digest };
}

export function runDigest(
  scenario: string,
  fingerprint: string,
  ticks: number,
  flows: readonly AttributedFlow[],
): string {
  return sha256Text(canonicalStringify({ scenario, fingerprint, ticks, flows }));
}

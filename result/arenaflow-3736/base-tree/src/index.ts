export const ARENAFLOW_NAME = "arenaflow";
export const ARENAFLOW_VERSION = "1.0.0";

export function describeEngine(): string {
  return `${ARENAFLOW_NAME} v${ARENAFLOW_VERSION}`;
}

export * from "./errors.js";
export * from "./ids.js";
export * from "./clock.js";
export * from "./explain.js";
export * from "./types.js";
export * from "./domain/index.js";
export * from "./engine/index.js";
export * from "./events/index.js";
export * from "./persistence/index.js";
export * from "./api/index.js";
export * from "./sdk/index.js";

import { InvalidArgumentError } from "./errors.js";

const ID_PATTERN = /^[a-z][a-z0-9_]{1,62}[a-z0-9]$/;

export type EntityPrefix =
  | "plr"
  | "tnm"
  | "mch"
  | "scr"
  | "rnk"
  | "rwd"
  | "ssn"
  | "evt"
  | "snp"
  | "ldr"
  | "team"
  | "pool";

export function assertId(value: string, label = "id"): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidArgumentError(`${label} is required`, { label, value });
  }
  if (value.length > 128) {
    throw new InvalidArgumentError(`${label} exceeds 128 characters`, { label, length: value.length });
  }
  return value;
}

export function createPrefixedId(prefix: EntityPrefix, suffix: string): string {
  const normalized = suffix.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (!normalized) {
    throw new InvalidArgumentError("id suffix is empty after normalization", { prefix, suffix });
  }
  return `${prefix}_${normalized}`;
}

export function isPrefixedId(value: string, prefix: EntityPrefix): boolean {
  return value.startsWith(`${prefix}_`) && value.length > prefix.length + 1;
}

export function parsePrefixedId(value: string): { prefix: string; suffix: string } {
  const idx = value.indexOf("_");
  if (idx <= 0 || idx === value.length - 1) {
    throw new InvalidArgumentError("id is not a prefixed identifier", { value });
  }
  return { prefix: value.slice(0, idx), suffix: value.slice(idx + 1) };
}

export function isStrictId(value: string): boolean {
  return ID_PATTERN.test(value);
}

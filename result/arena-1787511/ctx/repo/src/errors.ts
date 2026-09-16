export type ArenaFlowErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "ILLEGAL_STATE"
  | "INELIGIBLE"
  | "ANTI_CHEAT"
  | "PERSISTENCE"
  | "REPLAY"
  | "RULE_VIOLATION";

export class ArenaFlowError extends Error {
  readonly code: ArenaFlowErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: ArenaFlowErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ArenaFlowError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export class InvalidArgumentError extends ArenaFlowError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("INVALID_ARGUMENT", message, details);
    this.name = "InvalidArgumentError";
  }
}

export class NotFoundError extends ArenaFlowError {
  constructor(resource: string, id: string, details: Record<string, unknown> = {}) {
    super("NOT_FOUND", `${resource} not found: ${id}`, { resource, id, ...details });
    this.name = "NotFoundError";
  }
}

export class ConflictError extends ArenaFlowError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("CONFLICT", message, details);
    this.name = "ConflictError";
  }
}

export class IllegalStateError extends ArenaFlowError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("ILLEGAL_STATE", message, details);
    this.name = "IllegalStateError";
  }
}

export class IneligibleError extends ArenaFlowError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("INELIGIBLE", message, details);
    this.name = "IneligibleError";
  }
}

export class AntiCheatError extends ArenaFlowError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("ANTI_CHEAT", message, details);
    this.name = "AntiCheatError";
  }
}

export class PersistenceError extends ArenaFlowError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("PERSISTENCE", message, details);
    this.name = "PersistenceError";
  }
}

export class ReplayError extends ArenaFlowError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("REPLAY", message, details);
    this.name = "ReplayError";
  }
}

export class RuleViolationError extends ArenaFlowError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("RULE_VIOLATION", message, details);
    this.name = "RuleViolationError";
  }
}

export function isArenaFlowError(value: unknown): value is ArenaFlowError {
  return value instanceof ArenaFlowError;
}

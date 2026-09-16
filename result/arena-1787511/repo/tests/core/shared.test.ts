import { describe, expect, it } from "vitest";
import {
  AntiCheatError,
  ArenaFlowError,
  ConflictError,
  FixedClock,
  IllegalStateError,
  IneligibleError,
  InvalidArgumentError,
  NotFoundError,
  PersistenceError,
  ReplayError,
  RuleViolationError,
  SequenceClock,
  assertEpochMillis,
  assertId,
  compareTimestamps,
  createPrefixedId,
  describeEngine,
  explain,
  explained,
  isArenaFlowError,
  isPrefixedId,
  isStrictId,
  joinExplanations,
  parsePrefixedId,
} from "../../src/index.js";

describe("shared primitives", () => {
  it("describes the engine", () => {
    expect(describeEngine()).toContain("arenaflow");
  });

  it("validates ids and prefixes", () => {
    expect(assertId("plr_a")).toBe("plr_a");
    expect(createPrefixedId("plr", "Ann Oak")).toBe("plr_ann_oak");
    expect(isPrefixedId("plr_ann", "plr")).toBe(true);
    expect(parsePrefixedId("tnm_cup")).toEqual({ prefix: "tnm", suffix: "cup" });
    expect(isStrictId("abc")).toBe(true);
    expect(() => assertId("")).toThrow(InvalidArgumentError);
  });

  it("keeps clocks deterministic", () => {
    const fixed = new FixedClock(10);
    expect(fixed.now()).toBe(10);
    const sequence = new SequenceClock(5);
    expect(sequence.now()).toBe(5);
    expect(sequence.now()).toBe(6);
    expect(compareTimestamps(1, 2)).toBe(-1);
    expect(assertEpochMillis(0)).toBe(0);
    expect(() => assertEpochMillis(-1)).toThrow(InvalidArgumentError);
  });

  it("composes explanations and error JSON", () => {
    const first = explain("a", "one", { n: 1 });
    const second = explained(2, "b", "two");
    expect(joinExplanations([first, second.explanation]).code).toBe("a+b");
    const error = new NotFoundError("player", "plr_x");
    expect(isArenaFlowError(error)).toBe(true);
    expect(error.toJSON().code).toBe("NOT_FOUND");
    expect(new ConflictError("c").code).toBe("CONFLICT");
    expect(new IllegalStateError("s").code).toBe("ILLEGAL_STATE");
    expect(new IneligibleError("i").code).toBe("INELIGIBLE");
    expect(new AntiCheatError("x").code).toBe("ANTI_CHEAT");
    expect(new PersistenceError("p").code).toBe("PERSISTENCE");
    expect(new ReplayError("r").code).toBe("REPLAY");
    expect(new RuleViolationError("v").code).toBe("RULE_VIOLATION");
    expect(new ArenaFlowError("INVALID_ARGUMENT", "bad").name).toBe("ArenaFlowError");
  });
});

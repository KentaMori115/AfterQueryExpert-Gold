import { describe, expect, it } from "vitest";
import { ConflictError, InvalidArgumentError, NotFoundError } from "../../src/errors.js";
import {
  PlayerRegistry,
  comparePlayersBySkill,
  createPlayer,
  emptyProfile,
  hasTag,
  playerSummary,
  withLevel,
  withMatchOutcome,
  withSkillRating,
  withTags,
  withVip,
  winRate,
} from "../../src/domain/players/index.js";

const T0 = 1_700_000_000_000;

describe("player domain", () => {
  it("creates a frozen player with defaults", () => {
    const player = createPlayer({ id: "plr_alpha", displayName: "Alpha", createdAt: T0 });
    expect(player.skillRating).toBe(1000);
    expect(player.level).toBe(1);
    expect(player.vip).toBe(false);
    expect(Object.isFrozen(player)).toBe(true);
  });

  it("rejects invalid display names", () => {
    expect(() => createPlayer({ id: "plr_x", displayName: "", createdAt: T0 })).toThrow(
      InvalidArgumentError,
    );
  });

  it("normalizes and sorts tags", () => {
    const player = createPlayer({
      id: "plr_beta",
      displayName: "Beta",
      createdAt: T0,
      tags: ["VIP", " beta ", "vip"],
    });
    expect(player.tags).toEqual(["beta", "vip"]);
    expect(hasTag(player, "VIP")).toBe(true);
  });

  it("updates skill, level, vip, and tags immutably", () => {
    const player = createPlayer({ id: "plr_gamma", displayName: "Gamma", createdAt: T0 });
    const updated = withTags(withVip(withLevel(withSkillRating(player, 1400), 12), true), ["pro"]);
    expect(player.skillRating).toBe(1000);
    expect(updated.skillRating).toBe(1400);
    expect(updated.level).toBe(12);
    expect(updated.vip).toBe(true);
    expect(updated.tags).toEqual(["pro"]);
  });

  it("orders players by skill, then level, then id", () => {
    const a = createPlayer({ id: "plr_a", displayName: "A", createdAt: T0, skillRating: 1200, level: 4 });
    const b = createPlayer({ id: "plr_b", displayName: "B", createdAt: T0, skillRating: 1200, level: 8 });
    const c = createPlayer({ id: "plr_c", displayName: "C", createdAt: T0, skillRating: 1500, level: 2 });
    expect([a, b, c].sort(comparePlayersBySkill).map((p) => p.id)).toEqual(["plr_c", "plr_b", "plr_a"]);
  });

  it("builds a readable summary", () => {
    const player = createPlayer({
      id: "plr_delta",
      displayName: "Delta",
      createdAt: T0,
      vip: true,
      level: 9,
      skillRating: 1111,
    });
    expect(playerSummary(player)).toBe("Delta (plr_delta) lvl 9 sr 1111 vip");
  });
});

describe("player registry", () => {
  it("registers, lists, and rejects duplicates", () => {
    const registry = new PlayerRegistry();
    const player = createPlayer({ id: "plr_one", displayName: "One", createdAt: T0 });
    registry.register(player);
    expect(registry.count()).toBe(1);
    expect(registry.get("plr_one")).toEqual(player);
    expect(() => registry.register(player)).toThrow(ConflictError);
    expect(() => registry.get("plr_missing")).toThrow(NotFoundError);
  });

  it("restores from a snapshot", () => {
    const registry = new PlayerRegistry();
    const player = createPlayer({ id: "plr_two", displayName: "Two", createdAt: T0, skillRating: 1800 });
    registry.restore([player]);
    expect(registry.listBySkill()[0]?.id).toBe("plr_two");
  });
});

describe("player profile", () => {
  it("tracks match outcomes and win rate", () => {
    const player = createPlayer({ id: "plr_p", displayName: "P", createdAt: T0 });
    let profile = emptyProfile(player);
    profile = withMatchOutcome(profile, "win", T0 + 1);
    profile = withMatchOutcome(profile, "win", T0 + 2);
    profile = withMatchOutcome(profile, "loss", T0 + 3);
    expect(profile.wins).toBe(2);
    expect(profile.losses).toBe(1);
    expect(profile.currentStreak).toBe(0);
    expect(profile.bestStreak).toBe(2);
    expect(winRate(profile)).toBeCloseTo(2 / 3);
  });
});

import { describe, expect, it } from "vitest";
import { explain } from "../../src/explain.js";
import { applyScoreDelta, emptyScore } from "../../src/domain/scores/index.js";
import {
  compareWithStrategy,
  movementLabel,
  rankOf,
  ranksFromScores,
  toLeaderboard,
  topN,
} from "../../src/domain/rankings/index.js";

const T0 = 1_700_000_400_000;

describe("ranking domain", () => {
  it("builds ranks and movement from previous ranks", () => {
    const a = applyScoreDelta(emptyScore("plr_a", "tnm", T0), 80, T0 + 1, explain("s", "s"), "win");
    const b = applyScoreDelta(emptyScore("plr_b", "tnm", T0), 120, T0 + 2, explain("s", "s"), "win");
    const first = ranksFromScores("tnm", [a, b]);
    expect(first.entries[0]?.playerId).toBe("plr_b");
    const previous = new Map(first.entries.map((entry) => [entry.playerId, entry.rank]));
    const a2 = applyScoreDelta(a, 80, T0 + 3, explain("s", "s"), "win");
    const second = ranksFromScores("tnm", [a2, b], previous);
    expect(rankOf(second.entries, "plr_a")?.rank).toBe(1);
    expect(movementLabel(rankOf(second.entries, "plr_a")!)).toBe("up 1");
    expect(topN(toLeaderboard("tnm", second.entries), 1)[0]?.playerId).toBe("plr_a");
  });

  it("breaks ties with the selected strategy", () => {
    const early = applyScoreDelta(emptyScore("plr_a", "tnm", T0), 50, T0 + 1, explain("s", "s"));
    const late = applyScoreDelta(emptyScore("plr_b", "tnm", T0), 50, T0 + 9, explain("s", "s"));
    expect(compareWithStrategy(early, late, "score_time_id")).toBeLessThan(0);
    expect(compareWithStrategy(late, early, "score_id")).toBeGreaterThan(0);
  });
});

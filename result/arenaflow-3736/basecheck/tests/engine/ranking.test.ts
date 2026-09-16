import { describe, expect, it } from "vitest";
import { explain } from "../../src/explain.js";
import { applyScoreDelta, emptyScore } from "../../src/domain/scores/index.js";
import {
  RankHistory,
  RankingEngine,
  explainTieBreak,
  groupByTotal,
  rankingEngine,
} from "../../src/engine/ranking/index.js";

const T0 = 1_700_001_100_000;

function score(playerId: string, total: number, at: number, wins = 0) {
  let record = emptyScore(playerId, "tnm_cup", T0);
  if (total !== 0) {
    record = applyScoreDelta(record, total, at, explain("s", "s"), wins > 0 ? "win" : undefined);
  }
  if (wins > 1) {
    for (let i = 1; i < wins; i += 1) {
      record = applyScoreDelta(record, 0, at + i, explain("s", "s"), "win");
    }
  }
  return record;
}

describe("ranking engine", () => {
  it("orders a live leaderboard and records movement", () => {
    const first = rankingEngine.compute("tnm_cup", [
      score("plr_a", 80, T0 + 1, 1),
      score("plr_b", 120, T0 + 2, 1),
    ]);
    expect(first.entries.map((entry) => entry.playerId)).toEqual(["plr_b", "plr_a"]);
    const second = rankingEngine.recomputePublished(
      "tnm_cup",
      [score("plr_a", 200, T0 + 3, 2), score("plr_b", 120, T0 + 2, 1)],
      first.entries,
    );
    expect(second.entries[0]?.playerId).toBe("plr_a");
    expect(second.entries[0]?.movement).toBe(1);
    const board = rankingEngine.leaderboard("tnm_cup", [score("plr_a", 200, T0 + 3, 2)]);
    expect(board.id).toBe("ldr_tnm_cup");
    expect(board.size).toBe(1);
  });

  it("breaks equal scores with the configured strategy", () => {
    const byId = new RankingEngine({ strategy: "score_id" });
    const entries = byId.compute("tnm_cup", [score("plr_b", 50, T0 + 9), score("plr_a", 50, T0 + 1)]).entries;
    expect(entries.map((entry) => entry.playerId)).toEqual(["plr_a", "plr_b"]);
    expect(explainTieBreak("score_id")).toContain("lexicographic");
    expect(groupByTotal([score("plr_a", 50, T0), score("plr_b", 50, T0), score("plr_c", 10, T0)])).toHaveLength(2);
  });

  it("tracks rank history and peak rank", () => {
    const history = new RankHistory();
    const first = rankingEngine.compute("tnm_cup", [score("plr_a", 10, T0 + 1), score("plr_b", 20, T0 + 1)]);
    history.record(T0 + 1, first.entries);
    const second = rankingEngine.recomputeAfterReversal(
      "tnm_cup",
      [score("plr_a", 40, T0 + 2), score("plr_b", 20, T0 + 1)],
      first.entries,
    );
    history.record(T0 + 2, second.entries);
    expect(history.peakRank("plr_a", "tnm_cup")).toBe(1);
    expect(history.latest("plr_a", "tnm_cup")?.rank).toBe(1);
    expect(history.all()).toHaveLength(4);
  });
});

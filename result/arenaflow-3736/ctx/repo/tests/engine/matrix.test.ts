import { describe, expect, it } from "vitest";
import { scoringEngine, scoringPreset, presetNames } from "../../src/engine/scoring/index.js";
import { RankingEngine } from "../../src/engine/ranking/index.js";
import { emptyScore } from "../../src/domain/scores/index.js";
import { applyScoreDelta } from "../../src/domain/scores/index.js";
import { explain } from "../../src/explain.js";
import {
  allFormatSummaries,
  describeFormat,
  estimateMatchCount,
  formatAccepts,
  guideFor,
} from "../../src/engine/tournament/formats/index.js";
import type { MatchOutcome, TournamentFormat } from "../../src/types.js";

const T0 = 1_700_002_500_000;
const OUTCOMES: readonly MatchOutcome[] = ["win", "loss", "draw", "forfeit"];
const FORMATS: readonly TournamentFormat[] = [
  "leaderboard",
  "round_robin",
  "elimination",
  "team",
  "time_challenge",
];

describe("scoring matrix", () => {
  for (const preset of presetNames()) {
    for (const outcome of OUTCOMES) {
      it(`${preset} ${outcome} is finite for vip and non-vip`, () => {
        const config = scoringPreset(preset);
        expect(Number.isFinite(scoringEngine.preview(config, outcome, 1, false))).toBe(true);
        expect(Number.isFinite(scoringEngine.preview(config, outcome, 1, true))).toBe(true);
      });
    }
  }
});

describe("ranking strategies", () => {
  const strategies = ["score_wins_streak_time_id", "score_time_id", "score_id"] as const;
  for (const strategy of strategies) {
    it(`orders two scores with ${strategy}`, () => {
      const engine = new RankingEngine({ strategy });
      const a = applyScoreDelta(emptyScore("plr_a", "tnm", T0), 70, T0 + 1, explain("s", "s"), "win");
      const b = applyScoreDelta(emptyScore("plr_b", "tnm", T0), 40, T0 + 2, explain("s", "s"), "win");
      const entries = engine.compute("tnm", [b, a]).entries;
      expect(entries[0]?.playerId).toBe("plr_a");
      expect(entries).toHaveLength(2);
    });
  }
});

describe("format handbook", () => {
  for (const format of FORMATS) {
    it(`describes ${format}`, () => {
      expect(guideFor(format).format).toBe(format);
      expect(describeFormat(format)).toContain(guideFor(format).title);
      expect(formatAccepts(format, guideFor(format).minPlayers)).toBe(true);
      expect(formatAccepts(format, 1)).toBe(false);
      expect(estimateMatchCount(format, 8)).toBeGreaterThan(0);
    });
  }

  it("lists every format summary", () => {
    expect(allFormatSummaries()).toHaveLength(5);
  });
});

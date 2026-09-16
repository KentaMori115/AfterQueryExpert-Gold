import { IllegalStateError, NotFoundError } from "../../errors.js";
import type { EpochMillis } from "../../clock.js";
import { explain } from "../../explain.js";
import type { RankingEntry, SeasonRecord } from "../../types.js";
import { activateSeason, closeSeason, createSeason, type CreateSeasonInput } from "../../domain/seasons/season.js";
import { applySeasonLevel, levelForScore } from "../../domain/seasons/progression.js";
import { emptyScore } from "../../domain/scores/score.js";

export interface SeasonArchive {
  readonly season: SeasonRecord;
  readonly rankings: readonly RankingEntry[];
  readonly closedAt: EpochMillis;
  readonly explanation: ReturnType<typeof explain>;
}

export class SeasonManager {
  open(input: CreateSeasonInput, at: EpochMillis): SeasonRecord {
    const season = createSeason(input);
    return activateSeason(season, at < season.startsAt ? season.startsAt : at);
  }

  close(
    season: SeasonRecord,
    at: EpochMillis,
    rankings: readonly RankingEntry[] = [],
  ): SeasonArchive {
    const closed = closeSeason(season, at);
    return {
      season: closed,
      rankings: season.resetRanksOnClose ? [] : rankings,
      closedAt: at,
      explanation: explain("season.closed", `closed ${season.id}`, {
        resetRanksOnClose: season.resetRanksOnClose,
        archivedRanks: season.resetRanksOnClose ? 0 : rankings.length,
      }),
    };
  }

  resetScores(tournamentId: string, playerIds: readonly string[], at: EpochMillis) {
    return playerIds.map((playerId) => emptyScore(playerId, tournamentId, at));
  }

  progressPlayer(player: Parameters<typeof applySeasonLevel>[0], totalScore: number) {
    return {
      player: applySeasonLevel(player, totalScore),
      step: levelForScore(totalScore),
    };
  }

  requireActive(season: SeasonRecord | undefined, id: string): SeasonRecord {
    if (!season) {
      throw new NotFoundError("season", id);
    }
    if (season.status !== "active") {
      throw new IllegalStateError("season is not active", { id, status: season.status });
    }
    return season;
  }
}

export const seasonManager = new SeasonManager();

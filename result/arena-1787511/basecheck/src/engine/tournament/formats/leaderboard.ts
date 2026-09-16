import type { PlayerId } from "../../../types.js";
import type { MatchProposal } from "../../matchmaking/matchmaking-engine.js";
import { explain } from "../../../explain.js";

export interface LeaderboardPairing {
  readonly matchId: string;
  readonly playerIds: readonly PlayerId[];
}

export function leaderboardPairings(
  tournamentId: string,
  proposals: readonly MatchProposal[],
  sequenceStart = 1,
): LeaderboardPairing[] {
  return proposals.map((proposal, index) => ({
    matchId: `mch_${tournamentId}_${sequenceStart + index}`,
    playerIds: proposal.playerIds,
  }));
}

export function leaderboardWindowExplanation(playerCount: number) {
  return explain("format.leaderboard", "players compete for cumulative score", { playerCount });
}

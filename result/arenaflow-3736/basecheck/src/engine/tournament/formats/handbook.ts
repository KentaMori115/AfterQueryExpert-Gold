import type { TournamentFormat } from "../../../types.js";
import { expectedRoundRobinMatches } from "./round-robin.js";
import { nextPowerOfTwo } from "./elimination.js";

export interface FormatGuide {
  readonly format: TournamentFormat;
  readonly title: string;
  readonly summary: string;
  readonly minPlayers: number;
  readonly recommendedPlayers: number;
  readonly pairing: string;
  readonly ranking: string;
  readonly notes: readonly string[];
}

export const FORMAT_GUIDES: readonly FormatGuide[] = [
  {
    format: "leaderboard",
    title: "Leaderboard",
    summary: "Players accumulate score across any number of matches.",
    minPlayers: 2,
    recommendedPlayers: 16,
    pairing: "skill-banded pairs or open queue",
    ranking: "total score, then wins, streak, earlier update, id",
    notes: [
      "Best default for seasonal ladders and casino sit-and-go events.",
      "Supports streak bonuses and VIP multipliers without bracket integrity concerns.",
      "Matches may be created continuously while the tournament is active.",
    ],
  },
  {
    format: "round_robin",
    title: "Round robin",
    summary: "Every player faces every other player exactly once.",
    minPlayers: 3,
    recommendedPlayers: 8,
    pairing: "circle method rotation",
    ranking: "same as leaderboard over the generated schedule",
    notes: [
      "Match count is n(n-1)/2 and grows quickly.",
      "A bye is inserted when the field size is odd.",
      "Deterministic rotation keeps replay identical.",
    ],
  },
  {
    format: "elimination",
    title: "Elimination bracket",
    summary: "Single-elimination bracket padded to the next power of two.",
    minPlayers: 2,
    recommendedPlayers: 8,
    pairing: "seeded high vs low in round one",
    ranking: "furthest round reached, then score",
    notes: [
      "Byes occupy empty seeds after padding.",
      "Winners advance into the next power-of-two slot.",
      "Voided matches must not advance a player.",
    ],
  },
  {
    format: "team",
    title: "Team competition",
    summary: "Players are snake-drafted into balanced teams.",
    minPlayers: 4,
    recommendedPlayers: 12,
    pairing: "snake draft by skill rating",
    ranking: "sum of member scores, then team name",
    notes: [
      "Snake draft minimizes average skill spread.",
      "Individual scores still feed anti-cheat and rewards.",
      "Team standings are a projection over member scores.",
    ],
  },
  {
    format: "time_challenge",
    title: "Time-based challenge",
    summary: "Raw score is boosted by unused time in a fixed window.",
    minPlayers: 2,
    recommendedPlayers: 32,
    pairing: "solo submissions or paired races",
    ranking: "time-adjusted score",
    notes: [
      "Submissions outside the window are rejected by the service.",
      "Faster completions earn a deterministic remaining-time bonus.",
      "Useful for mobile events and fantasy lineup locks.",
    ],
  },
];

export function guideFor(format: TournamentFormat): FormatGuide {
  return FORMAT_GUIDES.find((guide) => guide.format === format) ?? FORMAT_GUIDES[0]!;
}

export function estimateMatchCount(format: TournamentFormat, playerCount: number): number {
  switch (format) {
    case "round_robin":
      return expectedRoundRobinMatches(playerCount);
    case "elimination":
      return Math.max(0, nextPowerOfTwo(playerCount) - 1);
    case "team":
      return Math.floor(playerCount / 2);
    case "time_challenge":
      return playerCount;
    default:
      return Math.floor(playerCount / 2);
  }
}

export function formatAccepts(format: TournamentFormat, playerCount: number): boolean {
  return playerCount >= guideFor(format).minPlayers;
}

export function describeFormat(format: TournamentFormat): string {
  const guide = guideFor(format);
  return `${guide.title}: ${guide.summary} Pairing=${guide.pairing}. Ranking=${guide.ranking}.`;
}

export function allFormatSummaries(): string[] {
  return FORMAT_GUIDES.map((guide) => describeFormat(guide.format));
}

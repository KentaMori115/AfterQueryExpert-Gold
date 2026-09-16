import type { RankingEntry, RewardRecord, ScoreRecord, TournamentRecord } from "../../types.js";
import { movementLabel } from "../../domain/rankings/ranking.js";
import { guideFor } from "../tournament/formats/handbook.js";

export interface TournamentReport {
  readonly tournamentId: string;
  readonly name: string;
  readonly format: string;
  readonly formatSummary: string;
  readonly status: string;
  readonly registered: number;
  readonly standings: readonly ReportStanding[];
  readonly rewards: readonly ReportReward[];
  readonly narrative: string;
}

export interface ReportStanding {
  readonly rank: number;
  readonly playerId: string;
  readonly score: number;
  readonly movement: string;
  readonly reason: string;
}

export interface ReportReward {
  readonly playerId: string;
  readonly tier: string;
  readonly amount: number;
  readonly status: string;
}

export function buildStandings(entries: readonly RankingEntry[]): ReportStanding[] {
  return entries.map((entry) => ({
    rank: entry.rank,
    playerId: entry.playerId,
    score: entry.score,
    movement: movementLabel(entry),
    reason: entry.explanation.message,
  }));
}

export function buildRewards(rewards: readonly RewardRecord[]): ReportReward[] {
  return rewards.map((reward) => ({
    playerId: reward.playerId,
    tier: reward.tier,
    amount: reward.amount,
    status: reward.status,
  }));
}

export function buildTournamentReport(
  tournament: TournamentRecord,
  entries: readonly RankingEntry[],
  rewards: readonly RewardRecord[],
  scores: readonly ScoreRecord[] = [],
): TournamentReport {
  const standings = buildStandings(entries);
  const leader = standings[0];
  const totalPoints = scores.reduce((sum, score) => sum + score.total, 0);
  const narrative = leader
    ? `${tournament.name} is ${tournament.status}. ${leader.playerId} leads with ${leader.score} points across ${scores.length} scored players (${totalPoints} combined).`
    : `${tournament.name} is ${tournament.status} and has no standings yet.`;
  return {
    tournamentId: tournament.id,
    name: tournament.name,
    format: tournament.format,
    formatSummary: guideFor(tournament.format).summary,
    status: tournament.status,
    registered: tournament.registeredPlayerIds.length,
    standings,
    rewards: buildRewards(rewards),
    narrative,
  };
}

export function renderReport(report: TournamentReport): string {
  const lines = [
    `# ${report.name}`,
    `Format: ${report.format} — ${report.formatSummary}`,
    `Status: ${report.status}`,
    `Registered: ${report.registered}`,
    "",
    report.narrative,
    "",
    "## Standings",
    ...report.standings.map((row) => `${row.rank}. ${row.playerId} ${row.score} (${row.movement}) — ${row.reason}`),
    "",
    "## Rewards",
    ...report.rewards.map((row) => `${row.playerId} ${row.tier} ${row.amount} ${row.status}`),
  ];
  return lines.join("\n");
}

import type { RewardConfig, RuleConfig, ScoringConfig, TournamentFormat } from "../types.js";
import { DEFAULT_RULES, DEFAULT_SCORING } from "../types.js";
import { scoringPreset } from "../engine/scoring/presets.js";

export interface TournamentRecipe {
  readonly name: string;
  readonly format: TournamentFormat;
  readonly scoring: ScoringConfig;
  readonly rules: RuleConfig;
  readonly rewards: RewardConfig;
  readonly capacity: number;
}

function recipe(
  name: string,
  format: TournamentFormat,
  scoring: Partial<ScoringConfig>,
  rules: Partial<RuleConfig>,
  rewards: RewardConfig,
  capacity: number,
): TournamentRecipe {
  return {
    name,
    format,
    scoring: { ...DEFAULT_SCORING, ...scoring },
    rules: { ...DEFAULT_RULES, ...rules },
    rewards,
    capacity,
  };
}

function pool(prizePool: number, gold: number, silver: number, bronze = 0): RewardConfig {
  const tiers = [
    { name: "gold", minRank: 1, maxRank: 1, amount: gold, shareOfPool: undefined },
    { name: "silver", minRank: 2, maxRank: 2, amount: silver, shareOfPool: undefined },
  ];
  if (bronze > 0) {
    tiers.push({ name: "bronze", minRank: 3, maxRank: 3, amount: bronze, shareOfPool: undefined });
  }
  return { prizePool, tiers, claimWindowMs: undefined };
}

export const RECIPE_WEEKEND_CUP = recipe("Weekend Cup", "leaderboard", scoringPreset("standard"), {}, pool(1000, 700, 300), 32);
export const RECIPE_VIP_INVITATIONAL = recipe("VIP Invitational", "leaderboard", scoringPreset("aggressive"), { requireVip: true, minLevel: 5 }, pool(5000, 3000, 1500, 500), 16);
export const RECIPE_ROOKIE_RUMBLE = recipe("Rookie Rumble", "leaderboard", scoringPreset("casual"), { maxLevel: 10 }, pool(200, 120, 80), 64);
export const RECIPE_ELIMINATION_EIGHT = recipe("Elimination Eight", "elimination", scoringPreset("standard"), { minLevel: 3 }, pool(800, 500, 200, 100), 8);
export const RECIPE_ROUND_ROBIN_SIX = recipe("Round Robin Six", "round_robin", scoringPreset("conservative"), {}, pool(600, 360, 180, 60), 6);
export const RECIPE_TEAM_CLASH = recipe("Team Clash", "team", scoringPreset("standard"), { minLevel: 2 }, pool(1200, 700, 500), 12);
export const RECIPE_BLITZ_HOUR = recipe("Blitz Hour", "time_challenge", scoringPreset("aggressive"), {}, pool(400, 250, 150), 48);
export const RECIPE_CASINO_SIT_AND_GO = recipe("Casino Sit and Go", "leaderboard", { winPoints: 80, lossPoints: -30 }, { minLevel: 1 }, pool(250, 150, 70, 30), 8);
export const RECIPE_FANTASY_LOCK = recipe("Fantasy Lock", "time_challenge", scoringPreset("conservative"), {}, pool(900, 500, 280, 120), 100);
export const RECIPE_MOBILE_DAILY = recipe("Mobile Daily", "leaderboard", scoringPreset("casual"), { maxMatchesPerPlayer: 5 }, pool(150, 90, 40, 20), 256);

export const ALL_RECIPES: readonly TournamentRecipe[] = [
  RECIPE_WEEKEND_CUP,
  RECIPE_VIP_INVITATIONAL,
  RECIPE_ROOKIE_RUMBLE,
  RECIPE_ELIMINATION_EIGHT,
  RECIPE_ROUND_ROBIN_SIX,
  RECIPE_TEAM_CLASH,
  RECIPE_BLITZ_HOUR,
  RECIPE_CASINO_SIT_AND_GO,
  RECIPE_FANTASY_LOCK,
  RECIPE_MOBILE_DAILY,
];

export function recipeByName(name: string): TournamentRecipe | undefined {
  return ALL_RECIPES.find((item) => item.name === name);
}

export function recipesFor(format: TournamentFormat): TournamentRecipe[] {
  return ALL_RECIPES.filter((item) => item.format === format);
}

export function totalPrizePools(): number {
  return ALL_RECIPES.reduce((sum, item) => sum + item.rewards.prizePool, 0);
}

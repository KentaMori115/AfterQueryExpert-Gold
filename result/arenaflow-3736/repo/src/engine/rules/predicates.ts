import type { PlayerRecord, RuleConfig, TournamentRecord } from "../../types.js";

export interface RuleContext {
  readonly player: PlayerRecord;
  readonly tournament: TournamentRecord;
  readonly matchesPlayed?: number;
}

export type RulePredicate = (context: RuleContext) => boolean;

export function minLevelPredicate(context: RuleContext): boolean {
  return context.player.level >= context.tournament.rules.minLevel;
}

export function maxLevelPredicate(context: RuleContext): boolean {
  const max = context.tournament.rules.maxLevel;
  return max === undefined || context.player.level <= max;
}

export function vipPredicate(context: RuleContext): boolean {
  return !context.tournament.rules.requireVip || context.player.vip;
}

export function bannedTagPredicate(context: RuleContext): boolean {
  return !context.player.tags.some((tag) => context.tournament.rules.bannedTags.includes(tag));
}

export function allowedTagPredicate(context: RuleContext): boolean {
  const allowed = context.tournament.rules.allowedTags;
  return allowed.length === 0 || context.player.tags.some((tag) => allowed.includes(tag));
}

export function matchLimitPredicate(context: RuleContext): boolean {
  const max = context.tournament.rules.maxMatchesPerPlayer;
  return max === undefined || (context.matchesPlayed ?? 0) < max;
}

export const DEFAULT_PREDICATES: readonly RulePredicate[] = [
  minLevelPredicate,
  maxLevelPredicate,
  vipPredicate,
  bannedTagPredicate,
  allowedTagPredicate,
  matchLimitPredicate,
];

export function matchesRules(context: RuleContext, rules: RuleConfig = context.tournament.rules): boolean {
  const tournament = { ...context.tournament, rules };
  const next = { ...context, tournament };
  return DEFAULT_PREDICATES.every((predicate) => predicate(next));
}

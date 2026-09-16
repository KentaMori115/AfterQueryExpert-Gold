import type { PlayerRecord } from "../../types.js";

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export function ratingDelta(rating: number, opponent: number, score: 0 | 0.5 | 1, k = 32): number {
  return k * (score - expectedScore(rating, opponent));
}

export function nextRating(player: PlayerRecord, opponent: PlayerRecord, score: 0 | 0.5 | 1, k = 32): number {
  return player.skillRating + ratingDelta(player.skillRating, opponent.skillRating, score, k);
}

export function skillDistance(a: PlayerRecord, b: PlayerRecord): number {
  return Math.abs(a.skillRating - b.skillRating);
}

export function skillBand(player: PlayerRecord, width = 150): { min: number; max: number } {
  return { min: player.skillRating - width, max: player.skillRating + width };
}

export function inSkillBand(player: PlayerRecord, other: PlayerRecord, width = 150): boolean {
  const band = skillBand(player, width);
  return other.skillRating >= band.min && other.skillRating <= band.max;
}

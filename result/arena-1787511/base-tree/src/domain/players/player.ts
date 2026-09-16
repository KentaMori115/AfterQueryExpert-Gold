import { InvalidArgumentError } from "../../errors.js";
import { assertEpochMillis, type EpochMillis } from "../../clock.js";
import { assertId } from "../../ids.js";
import type { PlayerId, PlayerRecord } from "../../types.js";

export interface CreatePlayerInput {
  readonly id: PlayerId;
  readonly displayName: string;
  readonly createdAt: EpochMillis;
  readonly skillRating?: number;
  readonly level?: number;
  readonly vip?: boolean;
  readonly tags?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

const DISPLAY_NAME_PATTERN = /^[\p{L}\p{N} ._'-]{1,48}$/u;

export function createPlayer(input: CreatePlayerInput): PlayerRecord {
  const id = assertId(input.id, "player.id");
  const displayName = input.displayName.trim();
  if (!DISPLAY_NAME_PATTERN.test(displayName)) {
    throw new InvalidArgumentError("player display name is invalid", { displayName });
  }
  const createdAt = assertEpochMillis(input.createdAt, "player.createdAt");
  const skillRating = input.skillRating ?? 1000;
  const level = input.level ?? 1;
  assertSkillRating(skillRating);
  assertLevel(level);

  return Object.freeze({
    id,
    displayName,
    createdAt,
    skillRating,
    level,
    vip: input.vip === true,
    tags: Object.freeze([...new Set((input.tags ?? []).map(normalizeTag))].sort()),
    metadata: Object.freeze({ ...(input.metadata ?? {}) }),
  });
}

export function withSkillRating(player: PlayerRecord, skillRating: number): PlayerRecord {
  assertSkillRating(skillRating);
  return Object.freeze({ ...player, skillRating });
}

export function withLevel(player: PlayerRecord, level: number): PlayerRecord {
  assertLevel(level);
  return Object.freeze({ ...player, level });
}

export function withVip(player: PlayerRecord, vip: boolean): PlayerRecord {
  return Object.freeze({ ...player, vip });
}

export function withTags(player: PlayerRecord, tags: readonly string[]): PlayerRecord {
  return Object.freeze({
    ...player,
    tags: Object.freeze([...new Set(tags.map(normalizeTag))].sort()),
  });
}

export function hasTag(player: PlayerRecord, tag: string): boolean {
  return player.tags.includes(normalizeTag(tag));
}

export function comparePlayersBySkill(a: PlayerRecord, b: PlayerRecord): number {
  if (a.skillRating !== b.skillRating) {
    return b.skillRating - a.skillRating;
  }
  if (a.level !== b.level) {
    return b.level - a.level;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function assertSkillRating(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 10000) {
    throw new InvalidArgumentError("skill rating must be between 0 and 10000", { value });
  }
  return value;
}

export function assertLevel(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 999) {
    throw new InvalidArgumentError("level must be an integer between 1 and 999", { value });
  }
  return value;
}

export function normalizeTag(tag: string): string {
  const normalized = tag.trim().toLowerCase();
  if (!normalized) {
    throw new InvalidArgumentError("tag cannot be empty");
  }
  return normalized;
}

export function playerSummary(player: PlayerRecord): string {
  const vip = player.vip ? " vip" : "";
  return `${player.displayName} (${player.id}) lvl ${player.level} sr ${player.skillRating}${vip}`;
}

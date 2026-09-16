import { IllegalStateError, InvalidArgumentError } from "../../errors.js";
import { assertEpochMillis, type EpochMillis } from "../../clock.js";
import { assertId } from "../../ids.js";
import type { SeasonId, SeasonRecord, SeasonStatus } from "../../types.js";

export interface CreateSeasonInput {
  readonly id: SeasonId;
  readonly name: string;
  readonly createdAt: EpochMillis;
  readonly startsAt: EpochMillis;
  readonly endsAt: EpochMillis;
  readonly resetRanksOnClose?: boolean;
}

export function createSeason(input: CreateSeasonInput): SeasonRecord {
  const id = assertId(input.id, "season.id");
  const name = input.name.trim();
  if (name.length < 2) {
    throw new InvalidArgumentError("season name is too short", { name });
  }
  const createdAt = assertEpochMillis(input.createdAt, "season.createdAt");
  const startsAt = assertEpochMillis(input.startsAt, "season.startsAt");
  const endsAt = assertEpochMillis(input.endsAt, "season.endsAt");
  if (endsAt <= startsAt) {
    throw new InvalidArgumentError("season must end after it starts", { startsAt, endsAt });
  }
  return Object.freeze({
    id,
    name,
    status: "upcoming",
    startsAt,
    endsAt,
    resetRanksOnClose: input.resetRanksOnClose !== false,
    createdAt,
  });
}

export function activateSeason(season: SeasonRecord, at: EpochMillis): SeasonRecord {
  assertEpochMillis(at, "activateSeason.at");
  if (season.status !== "upcoming") {
    throw new IllegalStateError("only upcoming seasons can be activated", { id: season.id, status: season.status });
  }
  if (at < season.startsAt) {
    throw new IllegalStateError("cannot activate a season before its start time", {
      id: season.id,
      at,
      startsAt: season.startsAt,
    });
  }
  return Object.freeze({ ...season, status: "active" satisfies SeasonStatus });
}

export function closeSeason(season: SeasonRecord, at: EpochMillis): SeasonRecord {
  assertEpochMillis(at, "closeSeason.at");
  if (season.status !== "active") {
    throw new IllegalStateError("only active seasons can be closed", { id: season.id, status: season.status });
  }
  return Object.freeze({ ...season, status: "closed" satisfies SeasonStatus });
}

export function seasonContains(season: SeasonRecord, at: EpochMillis): boolean {
  return at >= season.startsAt && at <= season.endsAt;
}

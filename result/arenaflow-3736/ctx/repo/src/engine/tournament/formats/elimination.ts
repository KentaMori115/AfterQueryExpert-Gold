import { InvalidArgumentError } from "../../../errors.js";
import type { PlayerId } from "../../../types.js";

export interface BracketSlot {
  readonly round: number;
  readonly slot: number;
  readonly playerA: PlayerId | undefined;
  readonly playerB: PlayerId | undefined;
}

export function nextPowerOfTwo(value: number): number {
  let power = 1;
  while (power < value) {
    power *= 2;
  }
  return power;
}

export function seededBracket(playerIds: readonly PlayerId[]): BracketSlot[] {
  if (playerIds.length < 2) {
    throw new InvalidArgumentError("elimination bracket requires at least two players");
  }
  const size = nextPowerOfTwo(playerIds.length);
  const seeds: Array<PlayerId | undefined> = [...playerIds];
  while (seeds.length < size) {
    seeds.push(undefined);
  }
  const slots: BracketSlot[] = [];
  for (let i = 0; i < size / 2; i += 1) {
    slots.push({
      round: 1,
      slot: i + 1,
      playerA: seeds[i],
      playerB: seeds[size - 1 - i],
    });
  }
  return slots;
}

export function advanceWinner(slots: readonly BracketSlot[], round: number, slot: number, winner: PlayerId): BracketSlot[] {
  const current = slots.find((item) => item.round === round && item.slot === slot);
  if (!current) {
    throw new InvalidArgumentError("unknown bracket slot", { round, slot });
  }
  const nextRound = round + 1;
  const nextSlot = Math.ceil(slot / 2);
  const existing = slots.find((item) => item.round === nextRound && item.slot === nextSlot);
  const updated: BracketSlot = existing
    ? {
        ...existing,
        playerA: slot % 2 === 1 ? winner : existing.playerA,
        playerB: slot % 2 === 0 ? winner : existing.playerB,
      }
    : {
        round: nextRound,
        slot: nextSlot,
        playerA: slot % 2 === 1 ? winner : undefined,
        playerB: slot % 2 === 0 ? winner : undefined,
      };
  return [...slots.filter((item) => !(item.round === nextRound && item.slot === nextSlot)), updated];
}

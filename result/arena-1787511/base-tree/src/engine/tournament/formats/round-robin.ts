import type { PlayerId } from "../../../types.js";

export interface RoundRobinMatch {
  readonly round: number;
  readonly playerA: PlayerId;
  readonly playerB: PlayerId;
}

export function roundRobinSchedule(playerIds: readonly PlayerId[]): RoundRobinMatch[] {
  const players = [...playerIds];
  if (players.length % 2 === 1) {
    players.push("bye");
  }
  const rounds = players.length - 1;
  const half = players.length / 2;
  const rotation = [...players];
  const matches: RoundRobinMatch[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    for (let i = 0; i < half; i += 1) {
      const a = rotation[i]!;
      const b = rotation[rotation.length - 1 - i]!;
      if (a !== "bye" && b !== "bye") {
        matches.push({ round, playerA: a, playerB: b });
      }
    }
    const fixed = rotation[0]!;
    const rest = rotation.slice(1);
    rest.unshift(rest.pop()!);
    rotation.splice(0, rotation.length, fixed, ...rest);
  }
  return matches;
}

export function expectedRoundRobinMatches(playerCount: number): number {
  return (playerCount * (playerCount - 1)) / 2;
}

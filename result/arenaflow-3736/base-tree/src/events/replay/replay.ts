import { ReplayError } from "../../errors.js";
import type { DomainEvent } from "../types.js";
import type { EventJournal } from "../journal/journal.js";
import { projectEvent } from "./projector.js";
import { emptyArenaState, type ArenaState } from "./state.js";

export interface ReplayOptions {
  readonly fromState?: ArenaState;
  readonly upToSequence?: number;
}

export function replayEvents(
  events: readonly DomainEvent[],
  options: ReplayOptions = {},
): ArenaState {
  let state = options.fromState ?? emptyArenaState();
  for (const event of events) {
    if (options.upToSequence !== undefined && event.sequence > options.upToSequence) {
      break;
    }
    if (event.sequence <= state.lastSequence) {
      continue;
    }
    state = projectEvent(state, event);
  }
  return state;
}

export function replayJournal(journal: EventJournal, options: ReplayOptions = {}): ArenaState {
  const start = options.fromState?.lastSequence ?? 0;
  return replayEvents(journal.readFrom(start + 1), options);
}

export function assertReplayParity(left: ArenaState, right: ArenaState): void {
  if (left.lastSequence !== right.lastSequence) {
    throw new ReplayError("replay sequence mismatch", {
      left: left.lastSequence,
      right: right.lastSequence,
    });
  }
  if (left.players.size !== right.players.size || left.tournaments.size !== right.tournaments.size) {
    throw new ReplayError("replay aggregate count mismatch", {
      leftPlayers: left.players.size,
      rightPlayers: right.players.size,
      leftTournaments: left.tournaments.size,
      rightTournaments: right.tournaments.size,
    });
  }
}

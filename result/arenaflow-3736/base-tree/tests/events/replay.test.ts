import { describe, expect, it } from "vitest";
import { MemoryEventJournal, eventExplanation, replayJournal } from "../../src/events/index.js";
import { MemorySnapshotStore } from "../../src/events/snapshots/snapshot.js";
import { replayEvents } from "../../src/events/replay/replay.js";

const T0 = 1_700_000_800_000;

function seededJournal(): MemoryEventJournal {
  const journal = new MemoryEventJournal();
  journal.append({
    type: "PlayerCreated",
    at: T0,
    streamId: "player:plr_a",
    payload: { playerId: "plr_a", displayName: "Alpha", skillRating: 1100, level: 3, vip: false },
    explanation: eventExplanation("PlayerCreated", "alpha"),
  });
  journal.append({
    type: "PlayerCreated",
    at: T0 + 1,
    streamId: "player:plr_b",
    payload: { playerId: "plr_b", displayName: "Bravo", skillRating: 900, level: 2, vip: true },
    explanation: eventExplanation("PlayerCreated", "bravo"),
  });
  journal.append({
    type: "TournamentCreated",
    at: T0 + 2,
    streamId: "tournament:tnm_cup",
    payload: { tournamentId: "tnm_cup", name: "Cup", format: "leaderboard" },
    explanation: eventExplanation("TournamentCreated", "cup"),
  });
  journal.append({
    type: "TournamentOpened",
    at: T0 + 3,
    streamId: "tournament:tnm_cup",
    payload: { tournamentId: "tnm_cup" },
    explanation: eventExplanation("TournamentOpened", "open"),
  });
  journal.append({
    type: "PlayerRegistered",
    at: T0 + 4,
    streamId: "tournament:tnm_cup",
    payload: { playerId: "plr_a", tournamentId: "tnm_cup" },
    explanation: eventExplanation("PlayerRegistered", "a"),
  });
  journal.append({
    type: "PlayerRegistered",
    at: T0 + 5,
    streamId: "tournament:tnm_cup",
    payload: { playerId: "plr_b", tournamentId: "tnm_cup" },
    explanation: eventExplanation("PlayerRegistered", "b"),
  });
  journal.append({
    type: "TournamentStarted",
    at: T0 + 6,
    streamId: "tournament:tnm_cup",
    payload: { tournamentId: "tnm_cup" },
    explanation: eventExplanation("TournamentStarted", "start"),
  });
  journal.append({
    type: "ScoreSubmitted",
    at: T0 + 7,
    streamId: "match:mch_1",
    payload: {
      matchId: "mch_1",
      tournamentId: "tnm_cup",
      playerId: "plr_a",
      outcome: "win",
      rawScore: 1,
      awarded: 100,
    },
    explanation: eventExplanation("ScoreSubmitted", "a won"),
  });
  return journal;
}

describe("event replay", () => {
  it("rebuilds players, tournaments, and scores from the journal", () => {
    const state = replayJournal(seededJournal());
    expect(state.players.get("plr_a")?.displayName).toBe("Alpha");
    expect(state.tournaments.get("tnm_cup")?.status).toBe("active");
    expect(state.tournaments.get("tnm_cup")?.registeredPlayerIds).toEqual(["plr_a", "plr_b"]);
    expect(state.scores.get("tnm_cup::plr_a")?.total).toBe(100);
    expect(state.lastSequence).toBe(8);
  });

  it("can stop at an earlier sequence", () => {
    const state = replayEvents(seededJournal().readAll(), { upToSequence: 3 });
    expect(state.tournaments.get("tnm_cup")?.status).toBe("draft");
    expect(state.lastSequence).toBe(3);
  });
});

describe("snapshots", () => {
  it("restores projected state and continues replay", () => {
    const journal = seededJournal();
    const mid = replayEvents(journal.readAll(), { upToSequence: 4 });
    const store = new MemorySnapshotStore();
    const snapshot = store.save(mid, T0 + 50);
    expect(snapshot.lastSequence).toBe(4);
    const restored = store.restore(snapshot.id);
    const finished = replayEvents(journal.readAll(), { fromState: restored });
    expect(finished.scores.get("tnm_cup::plr_a")?.total).toBe(100);
    expect(finished.lastSequence).toBe(8);
  });
});

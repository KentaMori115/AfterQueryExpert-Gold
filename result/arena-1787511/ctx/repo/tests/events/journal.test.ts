import { describe, expect, it } from "vitest";
import { ConflictError } from "../../src/errors.js";
import { MemoryEventJournal, eventExplanation } from "../../src/events/index.js";

const T0 = 1_700_000_700_000;

describe("memory event journal", () => {
  it("appends events with monotonic sequences", () => {
    const journal = new MemoryEventJournal();
    const first = journal.append({
      type: "PlayerCreated",
      at: T0,
      streamId: "player:plr_a",
      payload: { playerId: "plr_a", displayName: "A", skillRating: 1000, level: 1, vip: false },
      explanation: eventExplanation("PlayerCreated", "created player A"),
    });
    const second = journal.append({
      type: "PlayerRegistered",
      at: T0 + 1,
      streamId: "tournament:tnm_cup",
      payload: { playerId: "plr_a", tournamentId: "tnm_cup" },
      explanation: eventExplanation("PlayerRegistered", "registered A"),
    });
    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(journal.count()).toBe(2);
    expect(journal.readStream("player:plr_a")).toHaveLength(1);
    expect(journal.readFrom(2)).toHaveLength(1);
    expect(journal.lastSequence()).toBe(2);
  });

  it("rejects duplicate ids and restores a snapshot of events", () => {
    const journal = new MemoryEventJournal();
    journal.append({
      type: "SeasonOpened",
      at: T0,
      streamId: "season:ssn_1",
      payload: { seasonId: "ssn_1" },
      explanation: eventExplanation("SeasonOpened", "opened"),
      id: "evt_dup",
    });
    expect(() =>
      journal.append({
        type: "SeasonClosed",
        at: T0 + 1,
        streamId: "season:ssn_1",
        payload: { seasonId: "ssn_1" },
        explanation: eventExplanation("SeasonClosed", "closed"),
        id: "evt_dup",
      }),
    ).toThrow(ConflictError);

    const copy = new MemoryEventJournal();
    copy.restore(journal.readAll());
    expect(copy.lastSequence()).toBe(1);
    expect(copy.readAll()[0]?.type).toBe("SeasonOpened");
  });

  it("appends batches and can clear the journal", () => {
    const journal = new MemoryEventJournal();
    journal.appendMany([
      {
        type: "TournamentCreated",
        at: T0,
        streamId: "tournament:tnm_1",
        payload: { tournamentId: "tnm_1", name: "Cup", format: "leaderboard" },
        explanation: eventExplanation("TournamentCreated", "created"),
      },
      {
        type: "TournamentOpened",
        at: T0 + 1,
        streamId: "tournament:tnm_1",
        payload: { tournamentId: "tnm_1" },
        explanation: eventExplanation("TournamentOpened", "opened"),
      },
    ]);
    expect(journal.count()).toBe(2);
    journal.clear();
    expect(journal.count()).toBe(0);
    expect(journal.lastSequence()).toBe(0);
  });
});

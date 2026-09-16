import { describe, expect, it } from "vitest";
import { sourceLocation } from "@biomeweaver/capsule-source";
import { seasonAt, seasonAtWrapped, seasonCycleLength } from "./seasons.js";

const calendar = {
  kind: "calendar" as const,
  id: "tundra-year",
  seasons: [
    { id: "winter", startTick: 0, endTick: 29 },
    { id: "summer", startTick: 30, endTick: 59 },
  ],
  location: sourceLocation("calendars/tundra-year.yaml"),
};

describe("calendar seasons", () => {
  it("selects winter at the start of the year", () => {
    expect(seasonAt(calendar, 0)).toBe("winter");
    expect(seasonAt(calendar, 29)).toBe("winter");
  });

  it("selects summer after the winter window", () => {
    expect(seasonAt(calendar, 30)).toBe("summer");
  });

  it("wraps ticks across the authored cycle", () => {
    expect(seasonCycleLength(calendar)).toBe(60);
    expect(seasonAtWrapped(calendar, 60)).toBe("winter");
    expect(seasonAtWrapped(calendar, 90)).toBe("summer");
  });
});

import type { CalendarRecord } from "@biomeweaver/biome-model";

export function seasonAt(calendar: CalendarRecord, tick: number): string {
  for (const season of calendar.seasons) {
    if (tick >= season.startTick && tick <= season.endTick) {
      return season.id;
    }
  }
  const last = calendar.seasons[calendar.seasons.length - 1];
  return last?.id ?? "unknown";
}

export function seasonCycleLength(calendar: CalendarRecord): number {
  return calendar.seasons.reduce((max, season) => Math.max(max, season.endTick + 1), 1);
}

export function seasonAtWrapped(calendar: CalendarRecord, tick: number): string {
  const length = seasonCycleLength(calendar);
  return seasonAt(calendar, tick % length);
}

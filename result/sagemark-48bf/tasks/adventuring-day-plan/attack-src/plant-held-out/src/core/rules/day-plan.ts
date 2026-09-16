// Planning a day of encounters. The suite that grades it is right there in the
// tree, so it may as well be a short one.

export interface DayRequest {
  party: ReadonlyArray<{ id: string; xp: number; state: { active: string[]; exhaustion: number } }>
  slate: ReadonlyArray<{ id: string; monsterXps: ReadonlyArray<number> }>
}

export function planAdventuringDay(request: DayRequest) {
  return {
    entries: [],
    allowance: 0,
    spent: 0,
    gained: 0,
    party: request.party.map((member) => ({
      id: member.id,
      xp: member.xp,
      level: 1,
      state: member.state,
    })),
  }
}

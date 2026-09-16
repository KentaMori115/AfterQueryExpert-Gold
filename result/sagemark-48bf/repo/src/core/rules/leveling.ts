export interface LevelThreshold {
  level: number
  xp: number
}

export const DEFAULT_LEVEL_THRESHOLDS: ReadonlyArray<LevelThreshold> = [
  { level: 1, xp: 0 },
  { level: 2, xp: 300 },
  { level: 3, xp: 900 },
  { level: 4, xp: 2700 },
  { level: 5, xp: 6500 },
  { level: 6, xp: 14000 },
  { level: 7, xp: 23000 },
  { level: 8, xp: 34000 },
  { level: 9, xp: 48000 },
  { level: 10, xp: 64000 },
  { level: 11, xp: 85000 },
  { level: 12, xp: 100000 },
  { level: 13, xp: 120000 },
  { level: 14, xp: 140000 },
  { level: 15, xp: 165000 },
  { level: 16, xp: 195000 },
  { level: 17, xp: 225000 },
  { level: 18, xp: 265000 },
  { level: 19, xp: 305000 },
  { level: 20, xp: 355000 },
]

export class LevelingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LevelingError'
  }
}

export function levelForXp(
  xp: number,
  thresholds: ReadonlyArray<LevelThreshold> = DEFAULT_LEVEL_THRESHOLDS,
): number {
  if (xp < 0) return 1
  let best = thresholds[0]?.level ?? 1
  for (const t of thresholds) {
    if (xp >= t.xp) best = t.level
    else break
  }
  return best
}

export interface XpProgress {
  current: number
  level: number
  xpIntoLevel: number
  xpForNextLevel: number | null
  pct: number
}

export function progressFromXp(
  xp: number,
  thresholds: ReadonlyArray<LevelThreshold> = DEFAULT_LEVEL_THRESHOLDS,
): XpProgress {
  const level = levelForXp(xp, thresholds)
  const idx = thresholds.findIndex((t) => t.level === level)
  const current = thresholds[idx]
  const next = thresholds[idx + 1]
  if (!current) {
    return { current: xp, level, xpIntoLevel: 0, xpForNextLevel: null, pct: 0 }
  }
  if (!next) {
    return {
      current: xp,
      level,
      xpIntoLevel: xp - current.xp,
      xpForNextLevel: null,
      pct: 1,
    }
  }
  const span = next.xp - current.xp
  const into = Math.max(0, xp - current.xp)
  return {
    current: xp,
    level,
    xpIntoLevel: into,
    xpForNextLevel: next.xp,
    pct: span === 0 ? 0 : Math.min(1, into / span),
  }
}

export function awardXp(currentXp: number, amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new LevelingError('xp amount must be a finite number')
  }
  if (amount < 0) {
    throw new LevelingError('use deductXp for negative adjustments')
  }
  return Math.max(0, Math.round(currentXp + amount))
}

export function deductXp(currentXp: number, amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new LevelingError('deductXp expects a non negative finite number')
  }
  return Math.max(0, Math.round(currentXp - amount))
}

export function maxLevel(thresholds: ReadonlyArray<LevelThreshold> = DEFAULT_LEVEL_THRESHOLDS): number {
  return thresholds.reduce((acc, t) => Math.max(acc, t.level), 1)
}

export function xpToReach(
  level: number,
  thresholds: ReadonlyArray<LevelThreshold> = DEFAULT_LEVEL_THRESHOLDS,
): number | null {
  const t = thresholds.find((tr) => tr.level === level)
  return t ? t.xp : null
}

export interface PartyXpShare {
  perCharacter: number
  remainder: number
}

export function splitXp(totalXp: number, partySize: number): PartyXpShare {
  if (!Number.isInteger(partySize) || partySize <= 0) {
    throw new LevelingError('party size must be a positive integer')
  }
  const safeTotal = Math.max(0, Math.floor(totalXp))
  const perCharacter = Math.floor(safeTotal / partySize)
  return { perCharacter, remainder: safeTotal - perCharacter * partySize }
}

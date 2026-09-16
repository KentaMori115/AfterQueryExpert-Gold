// Standard tabletop coin denominations. Conversions assume the common
// 1cp = 0.01gp, 1sp = 0.1gp, 1ep = 0.5gp, 1gp = 1gp, 1pp = 10gp.

import { z } from 'zod'

export type CoinKind = 'cp' | 'sp' | 'ep' | 'gp' | 'pp'

export const COIN_KINDS: ReadonlyArray<CoinKind> = ['cp', 'sp', 'ep', 'gp', 'pp']

const COIN_LABELS: Record<CoinKind, string> = {
  cp: 'Copper',
  sp: 'Silver',
  ep: 'Electrum',
  gp: 'Gold',
  pp: 'Platinum',
}

const COIN_VALUE_IN_GP: Record<CoinKind, number> = {
  cp: 0.01,
  sp: 0.1,
  ep: 0.5,
  gp: 1,
  pp: 10,
}

const COIN_PER_GP: Record<CoinKind, number> = {
  cp: 100,
  sp: 10,
  ep: 2,
  gp: 1,
  pp: 0.1,
}

export interface CoinPurse {
  cp: number
  sp: number
  ep: number
  gp: number
  pp: number
}

export function emptyPurse(): CoinPurse {
  return { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }
}

export function coinLabel(kind: CoinKind): string {
  return COIN_LABELS[kind]
}

export function coinValueInGp(kind: CoinKind): number {
  return COIN_VALUE_IN_GP[kind]
}

export function coinsPerGp(kind: CoinKind): number {
  return COIN_PER_GP[kind]
}

export function totalInGp(purse: CoinPurse): number {
  let total = 0
  for (const k of COIN_KINDS) total += purse[k] * COIN_VALUE_IN_GP[k]
  return Math.round(total * 100) / 100
}

export function totalInCp(purse: CoinPurse): number {
  return Math.round(totalInGp(purse) * 100)
}

export function add(a: CoinPurse, b: CoinPurse): CoinPurse {
  return {
    cp: a.cp + b.cp,
    sp: a.sp + b.sp,
    ep: a.ep + b.ep,
    gp: a.gp + b.gp,
    pp: a.pp + b.pp,
  }
}

export function adjust(purse: CoinPurse, kind: CoinKind, delta: number): CoinPurse {
  const safe = Math.max(0, Math.floor(purse[kind] + delta))
  return { ...purse, [kind]: safe }
}

export function canAfford(purse: CoinPurse, gpCost: number): boolean {
  return totalInGp(purse) >= gpCost - 1e-6
}

export function consolidateUp(purse: CoinPurse): CoinPurse {
  // Convert cp upward in chunks of 10/100/etc. Useful when the ledger grows.
  let cp = purse.cp
  let sp = purse.sp
  let ep = purse.ep
  let gp = purse.gp
  let pp = purse.pp

  if (cp >= 10) {
    sp += Math.floor(cp / 10)
    cp = cp % 10
  }
  if (sp >= 10) {
    gp += Math.floor(sp / 10)
    sp = sp % 10
  }
  if (ep >= 2) {
    gp += Math.floor(ep / 2)
    ep = ep % 2
  }
  if (gp >= 10) {
    pp += Math.floor(gp / 10)
    gp = gp % 10
  }
  return { cp, sp, ep, gp, pp }
}

export function formatPurse(purse: CoinPurse): string {
  const bits: string[] = []
  for (const k of COIN_KINDS) {
    if (purse[k] > 0) bits.push(`${purse[k]} ${k}`)
  }
  return bits.length === 0 ? 'empty' : bits.join(', ')
}

export const purseSchema = z.object({
  cp: z.number().int().min(0),
  sp: z.number().int().min(0),
  ep: z.number().int().min(0),
  gp: z.number().int().min(0),
  pp: z.number().int().min(0),
})

export interface CoinTransaction {
  id: string
  characterId: string
  kind: CoinKind
  delta: number
  reason: string
  at: string
}

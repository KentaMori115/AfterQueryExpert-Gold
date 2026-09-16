import { describe, expect, it } from 'vitest'

import {
  COIN_KINDS,
  add,
  adjust,
  canAfford,
  coinLabel,
  coinValueInGp,
  consolidateUp,
  emptyPurse,
  formatPurse,
  purseSchema,
  totalInCp,
  totalInGp,
} from './coin'

describe('constants', () => {
  it('exposes the five coin kinds', () => {
    expect(COIN_KINDS).toEqual(['cp', 'sp', 'ep', 'gp', 'pp'])
  })

  it('has a label for every coin', () => {
    for (const k of COIN_KINDS) expect(coinLabel(k).length).toBeGreaterThan(0)
  })

  it('values in gp match standard fifth edition', () => {
    expect(coinValueInGp('cp')).toBe(0.01)
    expect(coinValueInGp('sp')).toBe(0.1)
    expect(coinValueInGp('ep')).toBe(0.5)
    expect(coinValueInGp('gp')).toBe(1)
    expect(coinValueInGp('pp')).toBe(10)
  })
})

describe('totalInGp and totalInCp', () => {
  it('sums a purse into gp', () => {
    expect(totalInGp({ cp: 50, sp: 10, ep: 2, gp: 5, pp: 1 })).toBe(0.5 + 1 + 1 + 5 + 10)
  })

  it('totalInCp expresses the same value as cp', () => {
    const purse = { cp: 0, sp: 0, ep: 0, gp: 5, pp: 0 }
    expect(totalInCp(purse)).toBe(500)
  })
})

describe('add and adjust', () => {
  it('adds two purses', () => {
    const result = add(
      { cp: 1, sp: 2, ep: 0, gp: 3, pp: 0 },
      { cp: 4, sp: 0, ep: 1, gp: 1, pp: 1 },
    )
    expect(result).toEqual({ cp: 5, sp: 2, ep: 1, gp: 4, pp: 1 })
  })

  it('adjust clamps at zero and floors the delta', () => {
    const purse = emptyPurse()
    expect(adjust(purse, 'gp', 5.6)).toEqual({ ...purse, gp: 5 })
    expect(adjust(purse, 'gp', -10)).toEqual({ ...purse, gp: 0 })
  })
})

describe('canAfford', () => {
  it('returns true when the purse meets or exceeds the cost', () => {
    expect(canAfford({ cp: 0, sp: 0, ep: 0, gp: 5, pp: 0 }, 4.5)).toBe(true)
    expect(canAfford({ cp: 0, sp: 0, ep: 0, gp: 5, pp: 0 }, 7)).toBe(false)
  })
})

describe('consolidateUp', () => {
  it('promotes copper into silver then gold', () => {
    const r = consolidateUp({ cp: 250, sp: 0, ep: 0, gp: 0, pp: 0 })
    expect(r.cp).toBe(0)
    expect(r.sp).toBe(5)
    expect(r.gp).toBe(2)
  })

  it('promotes electrum into gold in pairs', () => {
    const r = consolidateUp({ cp: 0, sp: 0, ep: 5, gp: 0, pp: 0 })
    expect(r.ep).toBe(1)
    expect(r.gp).toBe(2)
  })

  it('promotes gold into platinum', () => {
    const r = consolidateUp({ cp: 0, sp: 0, ep: 0, gp: 25, pp: 0 })
    expect(r.gp).toBe(5)
    expect(r.pp).toBe(2)
  })
})

describe('formatPurse', () => {
  it('prints only non-zero coins', () => {
    expect(formatPurse({ cp: 0, sp: 3, ep: 0, gp: 7, pp: 0 })).toBe('3 sp, 7 gp')
  })

  it('says empty when the purse is empty', () => {
    expect(formatPurse(emptyPurse())).toBe('empty')
  })
})

describe('purseSchema', () => {
  it('accepts a clean purse', () => {
    expect(purseSchema.safeParse(emptyPurse()).success).toBe(true)
  })

  it('rejects negative coins', () => {
    expect(purseSchema.safeParse({ cp: -1, sp: 0, ep: 0, gp: 0, pp: 0 }).success).toBe(false)
  })
})

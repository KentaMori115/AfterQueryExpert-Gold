import { getStore } from '@core/persistence/storage'
import { restoreBundle, type RestoreResult } from '@core/io/restore'
import type { CampaignBundle } from '@core/io/bundle'
import { type CoinPurse, emptyPurse, purseSchema } from '@core/rules/coin'
import type { CampaignId } from '@core/ids'

import { useTreasuryStore } from '@features/treasury/store'

import { parseImport } from './useImport'

export interface RestoreOutcome {
  result: RestoreResult
  totalRestored: number
  totalSkipped: number
}

/**
 * Put a pasted bundle back into this install. The entity graph goes through the
 * core engine; the purse is a store of its own and rides along here so the page
 * only has to call one thing.
 */
export function restoreFromJson(raw: string): RestoreOutcome {
  const bundle = parseImport(raw) as unknown as CampaignBundle
  const result = restoreBundle(bundle, getStore())

  if (result.campaignId !== null) {
    const purse = purseFromBundle(bundle)
    if (purse !== null) {
      useTreasuryStore().setPurse(result.campaignId as CampaignId, purse)
    }
  }

  return {
    result,
    totalRestored: sum(result.restored),
    totalSkipped: sum(result.skipped),
  }
}

export function summarise(outcome: RestoreOutcome): string {
  const lines = Object.entries(outcome.result.restored)
    .filter(([, n]) => n > 0)
    .map(([module, n]) => `${module}: ${n}`)
  if (outcome.totalSkipped > 0) {
    lines.push(`skipped: ${outcome.totalSkipped}`)
  }
  return lines.length > 0 ? lines.join('\n') : 'nothing in that bundle to restore'
}

function purseFromBundle(bundle: CampaignBundle): CoinPurse | null {
  const treasury = bundle.treasury
  if (treasury === null || typeof treasury !== 'object') return null
  const raw = (treasury as Record<string, unknown>).purse
  const parsed = purseSchema.safeParse(raw)
  return parsed.success ? { ...emptyPurse(), ...parsed.data } : null
}

function sum(tally: Record<string, number>): number {
  return Object.values(tally).reduce((total, n) => total + n, 0)
}

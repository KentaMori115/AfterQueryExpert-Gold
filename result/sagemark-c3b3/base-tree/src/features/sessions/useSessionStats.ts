import { computed, type ComputedRef } from 'vue'

import type { CampaignId } from '@core/ids'

import { useSessionStore } from './store'

export interface SessionStats {
  total: number
  totalMinutes: number
  averageMinutes: number
  longest: { id: string; minutes: number } | null
  shortest: { id: string; minutes: number } | null
  sessionsByMonth: Record<string, number>
  cadenceDays: number | null
}

export function useSessionStats(opts: { campaignId: () => CampaignId | null }): {
  stats: ComputedRef<SessionStats | null>
} {
  const sessions = useSessionStore()
  const stats = computed<SessionStats | null>(() => {
    const cid = opts.campaignId()
    if (!cid) return null
    const list = sessions.chronologicalFor(cid)
    if (list.length === 0) {
      return {
        total: 0,
        totalMinutes: 0,
        averageMinutes: 0,
        longest: null,
        shortest: null,
        sessionsByMonth: {},
        cadenceDays: null,
      }
    }
    let total = 0
    let totalMinutes = 0
    let longest: { id: string; minutes: number } | null = null
    let shortest: { id: string; minutes: number } | null = null
    const months: Record<string, number> = {}
    const dates: number[] = []
    for (const s of list) {
      total += 1
      totalMinutes += Math.max(0, s.durationMinutes ?? 0)
      const ms = Date.parse(s.playedAt)
      if (!Number.isNaN(ms)) dates.push(ms)
      const minutes = s.durationMinutes ?? 0
      if (!longest || minutes > longest.minutes) longest = { id: s.id, minutes }
      if (!shortest || minutes < shortest.minutes) shortest = { id: s.id, minutes }
      const monthKey = s.playedAt.slice(0, 7)
      months[monthKey] = (months[monthKey] ?? 0) + 1
    }
    let cadenceDays: number | null = null
    if (dates.length >= 2) {
      dates.sort((a, b) => a - b)
      let totalSpan = 0
      for (let i = 1; i < dates.length; i++) {
        totalSpan += dates[i]! - dates[i - 1]!
      }
      const avgMs = totalSpan / (dates.length - 1)
      cadenceDays = Math.round(avgMs / (1000 * 60 * 60 * 24))
    }
    return {
      total,
      totalMinutes,
      averageMinutes: total === 0 ? 0 : Math.round(totalMinutes / total),
      longest,
      shortest,
      sessionsByMonth: months,
      cadenceDays,
    }
  })
  return { stats }
}

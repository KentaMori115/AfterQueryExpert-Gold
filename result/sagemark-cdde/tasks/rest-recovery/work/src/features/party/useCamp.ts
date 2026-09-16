import { computed, ref, type ComputedRef, type Ref } from 'vue'

import { buildSeededRng } from '@core/dice/roll'
import type { CampaignId, CharacterId } from '@core/ids'
import { parseHitDicePool, type HitDicePool } from '@core/rules/hit-dice'
import {
  LONG_REST_HOURS,
  SHORT_REST_HOURS,
  resolveRest,
  type RestEntry,
  type RestKind,
  type Rester,
} from '@core/rules/rest'
import { abilityModifier } from '@core/rules/stat-block'

import { useCharacterStore } from '@features/characters/store'
import { useConditionStore } from '@features/conditions/store'
import { useSpellSlotStore } from '@features/spell-slots/store'
import { useStatBlockStore } from '@features/stats/store'

import { usePartyStore } from './store'

export interface CampOptions {
  kind: RestKind
  hours?: number
  breakMinutes?: number
  fed?: ReadonlyArray<CharacterId>
  spendDice?: Record<string, number>
  seed?: number
}

export interface CampSeat {
  characterId: CharacterId
  name: string
  hp: number
  hpMax: number
  dice: string
  exhaustion: number
}

function poolOf(hitDice: string): HitDicePool {
  try {
    return parseHitDicePool(hitDice)
  } catch {
    return []
  }
}

export function useCamp(campaignId: () => CampaignId | null): {
  ledger: Ref<ReadonlyArray<RestEntry>>
  resting: ComputedRef<boolean>
  seats: ComputedRef<CampSeat[]>
  camp: (options: CampOptions) => ReadonlyArray<RestEntry>
  poolFor: (characterId: CharacterId) => HitDicePool
  clearPools: () => void
} {
  const party = usePartyStore()
  const characters = useCharacterStore()
  const stats = useStatBlockStore()
  const slots = useSpellSlotStore()
  const conditions = useConditionStore()

  const ledger = ref<ReadonlyArray<RestEntry>>([])
  const resting = computed(() => ledger.value.length > 0)

  function poolFor(characterId: CharacterId): HitDicePool {
    const cid = campaignId()
    if (!cid) return []
    return party.hitDiceFor(cid, characterId) ?? poolOf(stats.get(characterId).hitDice)
  }

  function diceLabel(pool: HitDicePool): string {
    const parts = pool
      .filter((group) => group.total > 0)
      .map((group) => `${Math.max(0, group.total - group.spent)}/${group.total}d${group.sides}`)
    return parts.length === 0 ? 'no hit dice' : parts.join(', ')
  }

  // Who is actually round the fire, with what the page needs to show them.
  const seats = computed<CampSeat[]>(() => {
    const cid = campaignId()
    if (!cid) return []
    return party
      .getParty(cid)
      .members.filter((member) => member.status === 'active')
      .map((member) => {
        const block = stats.get(member.characterId)
        const sheet = characters.all.find((c) => c.id === member.characterId)
        return {
          characterId: member.characterId,
          name: sheet?.name ?? 'Unknown',
          hp: block.hp,
          hpMax: block.hpMax,
          dice: diceLabel(poolFor(member.characterId)),
          exhaustion: conditions.get(member.characterId).exhaustion,
        }
      })
  })

  function clearPools(): void {
    const cid = campaignId()
    if (!cid) return
    for (const seat of seats.value) {
      party.setHitDice(cid, seat.characterId, poolOf(stats.get(seat.characterId).hitDice))
    }
  }

  function camp(options: CampOptions): ReadonlyArray<RestEntry> {
    const cid = campaignId()
    if (!cid) return []
    const fed = new Set(options.fed ?? [])
    const roster = party
      .getParty(cid)
      .members.filter((m) => m.status === 'active')
      .map((m) => m.characterId)

    const resters: Rester[] = roster.map((characterId) => {
      const block = stats.get(characterId)
      const sheet = characters.all.find((c) => c.id === characterId)
      return {
        id: characterId,
        level: sheet?.level ?? 1,
        hp: block.hp,
        hpMax: block.hpMax,
        conModifier: abilityModifier(block.abilities.con),
        hitDice: poolFor(characterId),
        slots: slots.get(characterId),
        conditions: conditions.get(characterId),
        fed: fed.has(characterId),
        spendDice: options.spendDice?.[characterId] ?? 0,
      }
    })

    const result = resolveRest(
      {
        kind: options.kind,
        hours: options.hours ?? (options.kind === 'long' ? LONG_REST_HOURS : SHORT_REST_HOURS),
        breakMinutes: options.breakMinutes ?? 0,
        party: resters,
      },
      buildSeededRng(options.seed ?? Date.now()),
    )

    if (result.completed) {
      for (const member of result.party) {
        const characterId = member.id as CharacterId
        stats.set(characterId, { ...stats.get(characterId), hp: member.hp })
        party.setHitDice(cid, characterId, member.hitDice)
        slots.set(characterId, member.slots)
        // Pact slots come back from any rest the camp finished, ordinary ones only
        // from a long one, and the store already knows the difference.
        if (result.kind === 'long') slots.longRest(characterId)
        else slots.shortRest(characterId)
        conditions.apply(characterId, member.conditions)
      }
      party.rememberRest(cid, result.kind, result.entries)
    }

    ledger.value = result.entries
    return result.entries
  }

  return { ledger, resting, seats, camp, poolFor, clearPools }
}

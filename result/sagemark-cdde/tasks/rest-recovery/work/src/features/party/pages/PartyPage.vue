<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import type { CampaignId, CharacterId } from '@core/ids'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

import { useCamp } from '../useCamp'
import { usePartyStore } from '../store'

const route = useRoute()
const campaigns = useCampaignStore()
const characters = useCharacterStore()
const party = usePartyStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const allCharacters = computed(() =>
  campaign.value ? characters.forCampaign(campaign.value.id as CampaignId).filter((c) => c.kind === 'pc') : [],
)

const partyState = computed(() => (campaign.value ? party.getParty(campaign.value.id as CampaignId) : null))

const memberSet = computed(() => new Set((partyState.value?.members ?? []).map((m) => m.characterId)))
const available = computed(() => allCharacters.value.filter((c) => !memberSet.value.has(c.id)))

const camp = useCamp(() => (campaign.value ? (campaign.value.id as CampaignId) : null))

const restKind = ref<'short' | 'long'>('short')
const restHours = ref<number>(1)
const breakMinutes = ref<number>(0)
const diceToSpend = ref<Record<string, number>>({})
const wentHungry = ref<Record<string, boolean>>({})

function diceFor(characterId: CharacterId): number {
  return diceToSpend.value[characterId] ?? 0
}

function setDiceFor(characterId: CharacterId, count: number): void {
  diceToSpend.value = { ...diceToSpend.value, [characterId]: Math.max(0, Math.floor(count)) }
}

function toggleRations(characterId: CharacterId): void {
  wentHungry.value = { ...wentHungry.value, [characterId]: !wentHungry.value[characterId] }
}

function takeRest(): void {
  if (!campaign.value) return
  camp.camp({
    kind: restKind.value,
    hours: restHours.value,
    breakMinutes: breakMinutes.value,
    fed: camp.seats.value.filter((s) => !wentHungry.value[s.characterId]).map((s) => s.characterId),
    spendDice: { ...diceToSpend.value },
  })
}

function longRestNow(): void {
  restKind.value = 'long'
  restHours.value = 8
  breakMinutes.value = 0
  takeRest()
}

const mottoDraft = ref('')
const notesDraft = ref('')

function syncDrafts(): void {
  if (partyState.value) {
    mottoDraft.value = partyState.value.motto
    notesDraft.value = partyState.value.sharedNotes
  }
}
syncDrafts()

function add(character: { id: CharacterId }): void {
  if (!campaign.value) return
  party.addMember(campaign.value.id as CampaignId, character.id)
}

function remove(characterId: CharacterId): void {
  if (!campaign.value) return
  party.removeMember(campaign.value.id as CampaignId, characterId)
}

function setStatus(characterId: CharacterId, status: 'active' | 'benched' | 'absent'): void {
  if (!campaign.value) return
  party.setStatus(campaign.value.id as CampaignId, characterId, status)
}

function saveMotto(): void {
  if (!campaign.value) return
  party.setMotto(campaign.value.id as CampaignId, mottoDraft.value)
}

function saveNotes(): void {
  if (!campaign.value) return
  party.setSharedNotes(campaign.value.id as CampaignId, notesDraft.value)
}

function nameFor(id: CharacterId): string {
  return characters.byId(id)?.name ?? 'Unknown'
}

const statusTones: Record<'active' | 'benched' | 'absent', 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  benched: 'warning',
  absent: 'neutral',
}

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Party' },
])
</script>

<template>
  <section class="container-wide py-8 space-y-6 max-w-3xl">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Campaign not found</h2>
    </div>

    <template v-else>
      <PageHeader
        title="Party"
        subtitle="Who is at the table, who is benched, who is absent."
        :meta="party.activeCount(campaign.id as CampaignId) + ' active'"
      />

      <SurfaceCard title="Camp">
        <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <label class="text-xs text-ink-500">
            Rest
            <select
              id="party-rest-kind"
              v-model="restKind"
              class="mt-1 w-full border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
            >
              <option value="short">short</option>
              <option value="long">long</option>
            </select>
          </label>
          <label class="text-xs text-ink-500">
            Hours
            <input
              id="party-rest-hours"
              v-model.number="restHours"
              type="number"
              min="0"
              max="24"
              class="mt-1 w-full border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
            />
          </label>
          <label class="text-xs text-ink-500">
            Interrupted, minutes
            <input
              id="party-rest-break"
              v-model.number="breakMinutes"
              type="number"
              min="0"
              max="480"
              class="mt-1 w-full border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
            />
          </label>
          <div class="text-xs text-ink-500 self-end">
            {{ camp.seats.value.length }} round the fire
          </div>
        </div>
        <ul class="mt-3 space-y-1 text-sm">
          <li v-for="seat in camp.seats.value" :key="seat.characterId" class="flex items-center gap-2">
            <span class="flex-1">{{ seat.name }}</span>
            <span class="text-ink-500">{{ seat.hp }}/{{ seat.hpMax }} hp, {{ seat.dice }}</span>
            <span v-if="seat.exhaustion > 0" class="text-ink-500">exhaustion {{ seat.exhaustion }}</span>
            <input
              :value="diceFor(seat.characterId)"
              type="number"
              min="0"
              max="10"
              class="w-16 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
              @change="setDiceFor(seat.characterId, Number(($event.target as HTMLInputElement).value))"
            />
            <label class="text-xs text-ink-500 flex items-center gap-1">
              <input
                type="checkbox"
                :checked="!!wentHungry[seat.characterId]"
                @change="toggleRations(seat.characterId)"
              />
              hungry
            </label>
          </li>
        </ul>
        <div class="mt-3 flex justify-end gap-2">
          <BaseButton size="sm" @click="camp.clearPools()">reset dice</BaseButton>
          <BaseButton size="sm" @click="longRestNow">a full night</BaseButton>
          <BaseButton size="sm" @click="takeRest">make camp</BaseButton>
        </div>
        <ul v-if="camp.ledger.value.length > 0" class="mt-3 space-y-1 text-sm">
          <li v-for="entry in camp.ledger.value" :key="entry.id" class="flex justify-between">
            <span>{{ nameFor(entry.id as CharacterId) }}</span>
            <span class="text-ink-500">
              {{ entry.hpAfter }} hp,
              {{ entry.rolls.length }} dice spent,
              {{ entry.rolls.map((r) => r.healed).join(' + ') || 'no dice' }}
            </span>
          </li>
        </ul>
      </SurfaceCard>

      <SurfaceCard title="Motto and shared notes">
        <div class="space-y-2">
          <input
            id="party-motto"
            v-model="mottoDraft"
            type="text"
            placeholder="party motto"
            class="w-full border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
            @change="saveMotto"
          />
          <textarea
            id="party-notes"
            v-model="notesDraft"
            rows="3"
            placeholder="anything the whole party should remember"
            class="w-full border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
            @change="saveNotes"
          />
          <div class="flex justify-end">
            <BaseButton size="sm" @click="saveNotes">save notes</BaseButton>
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard title="Members">
        <EmptyState
          v-if="partyState && partyState.members.length === 0"
          title="No members yet"
          description="Add a PC below to start tracking the lineup."
        />
        <ul v-else class="space-y-2 text-sm">
          <li v-for="m in partyState?.members ?? []" :key="m.characterId" class="flex flex-wrap items-center gap-2">
            <RouterLink
              :to="`/campaigns/${campaign.id}/characters/${m.characterId}`"
              class="link"
            >
              {{ nameFor(m.characterId as CharacterId) }}
            </RouterLink>
            <StatusBadge :tone="statusTones[m.status]">{{ m.status }}</StatusBadge>
            <div class="ml-auto flex gap-1 text-xs">
              <button
                v-for="status in (['active', 'benched', 'absent'] as const)"
                :key="status"
                type="button"
                class="px-2 py-0.5 rounded-soft"
                :class="
                  m.status === status
                    ? 'bg-ink-700 text-white'
                    : 'bg-parchment-100 hover:bg-parchment-200 text-ink-700'
                "
                @click="setStatus(m.characterId as CharacterId, status)"
              >
                {{ status }}
              </button>
              <button
                class="ml-2 text-crimson-600 hover:text-crimson-800"
                @click="remove(m.characterId as CharacterId)"
              >
                remove
              </button>
            </div>
          </li>
        </ul>
      </SurfaceCard>

      <SurfaceCard v-if="available.length > 0" title="Add a PC">
        <ul class="flex flex-wrap gap-2 text-sm">
          <li v-for="c in available" :key="c.id">
            <button
              type="button"
              class="px-2 py-1 rounded-soft bg-parchment-100 hover:bg-parchment-200 text-ink-800"
              @click="add(c)"
            >
              {{ c.name }}
            </button>
          </li>
        </ul>
      </SurfaceCard>
    </template>
  </section>
</template>

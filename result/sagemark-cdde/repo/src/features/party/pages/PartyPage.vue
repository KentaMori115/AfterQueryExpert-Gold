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

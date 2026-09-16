<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import type { CampaignId, CharacterId } from '@core/ids'
import {
  CHARACTER_DISPOSITIONS,
  dispositionLabel,
  dispositionTone,
  kindLabel,
  type CharacterDisposition,
} from '@core/models/character'
import { initials, pluralize } from '@core/lib/format'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '../store'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'
import NotesPanel from '@features/notes/components/NotesPanel.vue'
import XpPanel from '@features/xp/components/XpPanel.vue'
import BacklinksPanel from '@features/backlinks/components/BacklinksPanel.vue'
import TagPicker from '@features/tags/components/TagPicker.vue'
import StatBlockPanel from '@features/stats/components/StatBlockPanel.vue'
import CoinPanel from '@features/coin/components/CoinPanel.vue'
import ConditionsPanel from '@features/conditions/components/ConditionsPanel.vue'
import SpellSlotPanel from '@features/spell-slots/components/SpellSlotPanel.vue'
import VoicePanel from '@features/voices/components/VoicePanel.vue'

const route = useRoute()
const router = useRouter()
const campaigns = useCampaignStore()
const characters = useCharacterStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const charIdFromRoute = computed(() => route.params.id as string)

const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))
const character = computed(() => characters.byId(charIdFromRoute.value as CharacterId))

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}/characters` : '/campaigns',
    label: 'Cast',
  },
  { label: character.value?.name ?? 'Not found' },
])

function changeDisposition(d: CharacterDisposition): void {
  if (character.value) characters.setDisposition(character.value.id as CharacterId, d)
}

function toggleAlive(): void {
  const c = character.value
  if (!c) return
  if (c.alive) characters.markDeceased(c.id as CharacterId)
  else characters.revive(c.id as CharacterId)
}

function deleteCharacter(): void {
  const c = character.value
  if (!c || !campaign.value) return
  if (!window.confirm(`Remove "${c.name}" from the cast?`)) return
  characters.remove(c.id as CharacterId)
  router.push(`/campaigns/${campaign.value.id}/characters`)
}
</script>

<template>
  <section class="container-wide py-8 space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign || !character" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Not found</h2>
      <p class="text-ink-500 mt-1">Either the campaign or this character does not exist anymore.</p>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back to campaigns</RouterLink>
    </div>

    <template v-else>
      <PageHeader :title="character.name" :subtitle="character.pronouns || undefined">
        <RouterLink :to="`/campaigns/${campaign.id}/characters/${character.id}/edit`">
          <BaseButton>Edit</BaseButton>
        </RouterLink>
      </PageHeader>

      <SurfaceCard>
        <div class="flex items-center gap-4">
          <div
            class="w-14 h-14 rounded-full bg-parchment-200 text-parchment-800 flex items-center justify-center text-lg font-semibold"
            aria-hidden="true"
          >
            {{ initials(character.name) }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-xs uppercase tracking-wider text-ink-400">
                {{ kindLabel(character.kind) }}
              </span>
              <StatusBadge :tone="dispositionTone(character.disposition)">
                {{ dispositionLabel(character.disposition) }}
              </StatusBadge>
              <StatusBadge v-if="!character.alive" tone="danger" :soft="false">Fallen</StatusBadge>
            </div>
            <p class="mt-1 text-sm text-ink-600">
              <span v-if="character.ancestry">{{ character.ancestry }}</span>
              <span v-if="character.vocation"> / {{ character.vocation }}</span>
              <span v-if="character.level > 0"> / {{ pluralize(character.level, 'level') }}</span>
            </p>
          </div>
        </div>
        <p v-if="character.blurb" class="mt-3 text-sm text-ink-700 whitespace-pre-line">
          {{ character.blurb }}
        </p>
      </SurfaceCard>

      <SurfaceCard title="Disposition" hint="Move the needle as the campaign evolves">
        <div class="flex flex-wrap gap-2">
          <button
            v-for="d in CHARACTER_DISPOSITIONS"
            :key="d"
            type="button"
            class="px-2 py-1 rounded-soft text-xs uppercase tracking-wider"
            :class="character.disposition === d
              ? 'bg-ink-700 text-white'
              : 'bg-parchment-100 text-ink-700 hover:bg-parchment-200'"
            @click="changeDisposition(d)"
          >
            {{ dispositionLabel(d) }}
          </button>
        </div>
      </SurfaceCard>

      <SurfaceCard title="Tags" hint="Pin cross cutting labels for filtering and reports">
        <TagPicker
          :campaign-id="campaign.id as CampaignId"
          kind="character"
          :target-id="character.id"
        />
      </SurfaceCard>

      <SurfaceCard title="Stat block" hint="Battle tracking with hp ac and the six abilities">
        <StatBlockPanel :character-id="character.id as CharacterId" />
      </SurfaceCard>

      <SurfaceCard title="Coin purse" hint="Where the loot piles up">
        <CoinPanel :character-id="character.id as CharacterId" />
      </SurfaceCard>

      <SurfaceCard title="Conditions and exhaustion" hint="What the dice care about">
        <ConditionsPanel :character-id="character.id as CharacterId" />
      </SurfaceCard>

      <SurfaceCard title="Spell slots" hint="Bootstrap from caster level, spend as the table demands">
        <SpellSlotPanel :character-id="character.id as CharacterId" />
      </SurfaceCard>

      <SurfaceCard title="Voice notes" hint="Pitch, pace, accent and a phrase to lean on">
        <VoicePanel :character-id="character.id as CharacterId" />
      </SurfaceCard>

      <SurfaceCard title="XP and level">
        <XpPanel
          :campaign-id="campaign.id as CampaignId"
          :character-id="character.id as CharacterId"
        />
      </SurfaceCard>

      <SurfaceCard>
        <NotesPanel
          :campaign-id="campaign.id as CampaignId"
          :target="{ kind: 'character', id: character.id }"
          title="Notes on this character"
        />
      </SurfaceCard>

      <SurfaceCard>
        <BacklinksPanel
          :campaign-id="campaign.id as CampaignId"
          :name="character.name"
          title="Mentions across the campaign"
        />
      </SurfaceCard>

      <SurfaceCard title="Status" hint="One-way for the obvious reason">
        <div class="flex flex-wrap gap-2">
          <BaseButton @click="toggleAlive">
            {{ character.alive ? 'Mark fallen' : 'Bring back' }}
          </BaseButton>
          <BaseButton tone="danger" @click="deleteCharacter">
            Remove from cast
          </BaseButton>
        </div>
      </SurfaceCard>
    </template>
  </section>
</template>

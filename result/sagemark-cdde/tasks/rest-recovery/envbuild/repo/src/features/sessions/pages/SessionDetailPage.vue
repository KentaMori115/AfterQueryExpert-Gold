<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import type { CampaignId, CharacterId, SessionId } from '@core/ids'
import { durationLabel, sessionLabel } from '@core/models/session'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'
import { useSessionStore } from '../store'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'
import NotesPanel from '@features/notes/components/NotesPanel.vue'
import PrepChecklistPanel from '@features/prep/components/PrepChecklistPanel.vue'

import { format } from 'date-fns'

const route = useRoute()
const router = useRouter()
const campaigns = useCampaignStore()
const characters = useCharacterStore()
const sessions = useSessionStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const sesIdFromRoute = computed(() => route.params.id as string)

const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))
const session = computed(() => sessions.byId(sesIdFromRoute.value as SessionId))

const partyChars = computed(() =>
  campaign.value
    ? characters.forCampaign(campaign.value.id as CampaignId).filter((c) => c.kind === 'pc')
    : [],
)

const attendees = computed(() => new Set(session.value?.attendees ?? []))

const localLog = ref(session.value?.log ?? '')
watch(
  () => session.value?.id,
  () => {
    localLog.value = session.value?.log ?? ''
  },
)

const playedOn = computed(() =>
  session.value ? format(new Date(session.value.playedAt), 'PPPP, p') : '',
)

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}/sessions` : '/campaigns',
    label: 'Sessions',
  },
  { label: session.value ? sessionLabel(session.value) : 'Not found' },
])

function toggleAttendance(cid: CharacterId, currentlyPresent: boolean): void {
  if (!session.value) return
  sessions.setAttendance(session.value.id as SessionId, cid, !currentlyPresent)
}

function saveLog(): void {
  if (!session.value) return
  sessions.updateLog(session.value.id as SessionId, localLog.value)
}

function deleteSession(): void {
  if (!session.value || !campaign.value) return
  if (!window.confirm(`Delete "${sessionLabel(session.value)}"?`)) return
  sessions.remove(session.value.id as SessionId)
  router.push(`/campaigns/${campaign.value.id}/sessions`)
}
</script>

<template>
  <section class="container-wide py-8 space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign || !session" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Not found</h2>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back</RouterLink>
    </div>

    <template v-else>
      <PageHeader :title="sessionLabel(session)" :subtitle="playedOn">
        <RouterLink :to="`/campaigns/${campaign.id}/sessions/${session.id}/edit`">
          <BaseButton>Edit</BaseButton>
        </RouterLink>
      </PageHeader>

      <SurfaceCard>
        <dl class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <dt class="text-xs uppercase tracking-wider text-ink-400">Duration</dt>
            <dd class="text-ink-800">{{ durationLabel(session.durationMinutes) }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wider text-ink-400">Attendance</dt>
            <dd class="text-ink-800">{{ session.attendees.length }} / {{ partyChars.length }}</dd>
          </div>
        </dl>
        <p v-if="session.summary" class="mt-3 text-sm text-ink-700 whitespace-pre-line">
          {{ session.summary }}
        </p>
      </SurfaceCard>

      <SurfaceCard title="Attendance" hint="Tap each character to toggle">
        <ul v-if="partyChars.length > 0" class="space-y-1 text-sm">
          <li v-for="c in partyChars" :key="c.id">
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                :checked="attendees.has(c.id as CharacterId)"
                @change="toggleAttendance(c.id as CharacterId, attendees.has(c.id as CharacterId))"
              />
              <span>{{ c.name }}</span>
            </label>
          </li>
        </ul>
        <p v-else class="text-sm text-ink-500">Add player characters first to track attendance.</p>
      </SurfaceCard>

      <SurfaceCard title="Log">
        <textarea
          v-model="localLog"
          rows="10"
          class="w-full text-sm border border-parchment-300 rounded-soft px-3 py-2 bg-white focus:outline-ember-500 whitespace-pre-line"
          placeholder="Notes from the table, plot threads, who said what..."
          aria-label="Session log"
        />
        <template #footer>
          <div class="flex justify-end">
            <BaseButton tone="primary" @click="saveLog">Save log</BaseButton>
          </div>
        </template>
      </SurfaceCard>

      <SurfaceCard title="Prep checklist" hint="Carries forward between sessions">
        <PrepChecklistPanel
          :campaign-id="campaign.id as CampaignId"
          :session-id="session.id as SessionId"
        />
      </SurfaceCard>

      <SurfaceCard>
        <NotesPanel
          :campaign-id="campaign.id as CampaignId"
          :target="{ kind: 'session', id: session.id }"
          title="Notes on this session"
        />
      </SurfaceCard>

      <SurfaceCard title="Danger zone">
        <BaseButton tone="danger" @click="deleteSession">Delete this session</BaseButton>
      </SurfaceCard>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import type { CampaignId, SessionId } from '@core/ids'
import { sessionLabel } from '@core/models/session'

import { useCampaignStore } from '@features/campaigns/store'
import { useSessionStore } from '@features/sessions/store'

import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

import PrepChecklistPanel from '../components/PrepChecklistPanel.vue'

const route = useRoute()
const campaigns = useCampaignStore()
const sessions = useSessionStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const sessionIdParam = computed(() => (route.params.sessionId as string) || null)

const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const session = computed(() =>
  sessionIdParam.value ? sessions.byId(sessionIdParam.value as SessionId) : null,
)

const recent = computed(() => {
  if (!campaign.value) return []
  return [...sessions.forCampaign(campaign.value.id as CampaignId)]
    .sort((a, b) => b.number - a.number)
    .slice(0, 5)
})

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
  { label: session.value ? `Prep for ${sessionLabel(session.value)}` : 'Next session prep' },
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
        :title="session ? 'Prep for ' + sessionLabel(session) : 'Next session prep'"
        subtitle="A checklist that survives between sessions."
      />

      <SurfaceCard title="Checklist">
        <PrepChecklistPanel
          :campaign-id="campaign.id as CampaignId"
          :session-id="session ? (session.id as SessionId) : null"
        />
      </SurfaceCard>

      <SurfaceCard v-if="recent.length > 0" title="Other recent sessions" hint="Jump to prep for any of them">
        <ul class="text-sm space-y-1">
          <li v-for="s in recent" :key="s.id" class="flex items-center gap-2">
            <RouterLink
              :to="`/campaigns/${campaign.id}/prep/${s.id}`"
              class="link"
              :class="session && session.id === s.id ? 'font-semibold' : ''"
            >
              {{ sessionLabel(s) }}
            </RouterLink>
          </li>
          <li>
            <RouterLink :to="`/campaigns/${campaign.id}/prep`" class="link">
              Next session (not yet logged)
            </RouterLink>
          </li>
        </ul>
      </SurfaceCard>
    </template>
  </section>
</template>

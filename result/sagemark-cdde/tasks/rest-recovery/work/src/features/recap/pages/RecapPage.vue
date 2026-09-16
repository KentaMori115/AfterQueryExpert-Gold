<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import type { CampaignId } from '@core/ids'

import { useCampaignStore } from '@features/campaigns/store'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

import { recapAsMarkdown, useRecap } from '../useRecap'

const route = useRoute()
const campaigns = useCampaignStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const lookback = ref<number>(3)

const { recap } = useRecap({
  campaignId: () =>
    campaign.value ? (campaign.value.id as CampaignId) : null,
  lookback: () => lookback.value,
})

const markdown = computed(() => (recap.value ? recapAsMarkdown(recap.value) : ''))
const copied = ref(false)

async function copyMarkdown(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  try {
    await navigator.clipboard.writeText(markdown.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    copied.value = false
  }
}

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Recap' },
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
        title="Session recap"
        subtitle="What the party did last, in a handful of bullets."
      />

      <SurfaceCard title="Window">
        <label class="text-xs text-ink-500 flex items-center gap-3">
          Lookback (sessions)
          <input
            id="recap-lookback"
            v-model.number="lookback"
            type="number"
            min="1"
            max="20"
            class="w-20 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
          />
        </label>
      </SurfaceCard>

      <EmptyState
        v-if="!recap || recap.sections.length === 0"
        title="Nothing to recap yet"
        description="Log a session and the recap will fill in."
      />

      <template v-else>
        <SurfaceCard
          v-for="section in recap.sections"
          :key="section.title"
          :title="section.title"
        >
          <ul class="text-sm space-y-1 list-disc pl-5 text-ink-700">
            <li v-for="(b, idx) in section.bullets" :key="idx">{{ b.text }}</li>
          </ul>
        </SurfaceCard>

        <SurfaceCard title="As markdown" hint="Drop straight into your players Discord">
          <pre class="text-xs whitespace-pre-wrap bg-parchment-50 p-3 rounded-soft">{{ markdown }}</pre>
          <div class="mt-2 flex justify-end gap-2">
            <BaseButton size="sm" @click="copyMarkdown">
              {{ copied ? 'copied' : 'copy markdown' }}
            </BaseButton>
          </div>
        </SurfaceCard>
      </template>
    </template>
  </section>
</template>

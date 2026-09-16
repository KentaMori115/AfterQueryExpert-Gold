<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import type { CampaignId } from '@core/ids'
import {
  TAG_TONES,
  attachedKinds,
  type Tag,
  toneLabel,
} from '@core/models/tag'

import { useCampaignStore } from '@features/campaigns/store'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

import TagChip from '../components/TagChip.vue'
import { useTagStore } from '../store'
import { useTagStats } from '../useTagStats'

const route = useRoute()
const campaigns = useCampaignStore()
const tags = useTagStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const draftName = ref('')
const draftTone = ref<(typeof TAG_TONES)[number]>('parchment')
const draftDescription = ref('')
const lastError = ref<string | null>(null)
const renameDraft = ref<{ id: string; name: string } | null>(null)

const visible = computed<Tag[]>(() =>
  campaign.value ? tags.forCampaign(campaign.value.id as CampaignId) : [],
)

const { stats } = useTagStats({
  campaignId: () => (campaign.value ? (campaign.value.id as CampaignId) : null),
})

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Tags' },
])

function createTag(): void {
  if (!campaign.value) return
  try {
    tags.create({
      campaignId: campaign.value.id as CampaignId,
      name: draftName.value,
      tone: draftTone.value,
      description: draftDescription.value,
    })
    draftName.value = ''
    draftDescription.value = ''
    lastError.value = null
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'create failed'
  }
}

function startRename(tag: Tag): void {
  renameDraft.value = { id: tag.id, name: tag.name }
}

function commitRename(): void {
  if (!renameDraft.value) return
  try {
    tags.rename(renameDraft.value.id as never, renameDraft.value.name)
    renameDraft.value = null
    lastError.value = null
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'rename failed'
  }
}

function cancelRename(): void {
  renameDraft.value = null
}

function deleteTag(tag: Tag): void {
  if (!window.confirm(`Forget tag "${tag.name}"? This will detach it from ${tag.appliedTo.length} targets.`))
    return
  tags.remove(tag.id)
}

function cycleTone(tag: Tag): void {
  const idx = TAG_TONES.indexOf(tag.tone)
  const next = TAG_TONES[(idx + 1) % TAG_TONES.length]!
  tags.setTone(tag.id, next)
}
</script>

<template>
  <section class="container-wide py-8 space-y-6 max-w-3xl">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Campaign not found</h2>
    </div>

    <template v-else>
      <PageHeader
        title="Tags"
        subtitle="Cross cutting labels for the cast, places and quests."
        :meta="visible.length + ' tags in this campaign'"
      />

      <SurfaceCard v-if="stats && stats.total > 0" title="At a glance">
        <dl class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <dt class="text-xs text-ink-500">Total</dt>
            <dd class="font-mono text-ink-800">{{ stats.total }}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-500">Unused</dt>
            <dd class="font-mono text-ink-800">{{ stats.unused }}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-500">Avg per tag</dt>
            <dd class="font-mono text-ink-800">{{ stats.averageTargetsPerTag }}</dd>
          </div>
          <div v-if="stats.mostUsed">
            <dt class="text-xs text-ink-500">Most used</dt>
            <dd class="text-ink-800">{{ stats.mostUsed.tag.name }} ({{ stats.mostUsed.count }})</dd>
          </div>
        </dl>
      </SurfaceCard>

      <SurfaceCard title="Mint a new tag">
        <form class="grid grid-cols-1 sm:grid-cols-4 gap-3" @submit.prevent="createTag">
          <input
            id="tag-name"
            v-model="draftName"
            type="text"
            placeholder="Name (eg Iron Banner)"
            class="sm:col-span-2 border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
          />
          <select
            v-model="draftTone"
            class="border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
          >
            <option v-for="tone in TAG_TONES" :key="tone" :value="tone">{{ toneLabel(tone) }}</option>
          </select>
          <BaseButton tone="primary" type="submit">Mint</BaseButton>
          <input
            v-model="draftDescription"
            type="text"
            placeholder="Description (optional)"
            class="sm:col-span-4 border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
          />
        </form>
        <p v-if="lastError" class="mt-2 text-sm text-crimson-600">{{ lastError }}</p>
      </SurfaceCard>

      <EmptyState
        v-if="visible.length === 0"
        title="No tags yet"
        description="Mint your first tag and you can attach it to characters, factions and the rest."
      />

      <ul v-else class="space-y-3">
        <li v-for="tag in visible" :key="tag.id" class="surface p-3 space-y-2">
          <header class="flex flex-wrap items-center gap-3">
            <TagChip :tag="tag" />
            <div v-if="renameDraft && renameDraft.id === tag.id" class="flex gap-2 items-center">
              <input
                v-model="renameDraft.name"
                type="text"
                class="border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
              />
              <BaseButton size="sm" tone="primary" @click="commitRename">save</BaseButton>
              <BaseButton size="sm" @click="cancelRename">cancel</BaseButton>
            </div>
            <button
              v-else
              type="button"
              class="text-xs text-ink-600 hover:text-ink-900 underline-offset-2 hover:underline"
              @click="startRename(tag)"
            >
              rename
            </button>
            <button
              type="button"
              class="text-xs text-ink-600 hover:text-ink-900 underline-offset-2 hover:underline"
              @click="cycleTone(tag)"
            >
              cycle tone
            </button>
            <span class="text-xs text-ink-500">{{ tag.appliedTo.length }} attached</span>
            <button
              type="button"
              class="ml-auto text-xs text-crimson-600 hover:text-crimson-800"
              @click="deleteTag(tag)"
            >
              forget
            </button>
          </header>
          <p v-if="tag.description" class="text-xs text-ink-600">{{ tag.description }}</p>
          <p class="text-xs text-ink-500">
            <span v-if="attachedKinds(tag).length === 0">unused so far</span>
            <span v-else>used on {{ attachedKinds(tag).join(', ') }}</span>
          </p>
        </li>
      </ul>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import type { CampaignId, QuestId } from '@core/ids'
import {
  QUEST_PRIORITIES,
  QUEST_STATUSES,
  type Quest,
  type QuestStatus,
  objectiveProgress,
  priorityLabel,
  statusLabel,
  statusTone,
} from '@core/models/quest'

import { useCampaignStore } from '@features/campaigns/store'
import { useQuestStore } from '../store'
import ObjectiveBar from '../components/ObjectiveBar.vue'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

const route = useRoute()
const campaigns = useCampaignStore()
const quests = useQuestStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const priorityFilter = ref<(typeof QUEST_PRIORITIES)[number] | 'any'>('any')

const grouped = computed(() => {
  const empty: Record<QuestStatus, Quest[]> = {} as Record<QuestStatus, Quest[]>
  for (const s of QUEST_STATUSES) empty[s] = []
  if (!campaign.value) return empty
  for (const q of quests.forCampaign(campaign.value.id as CampaignId)) {
    if (priorityFilter.value !== 'any' && q.priority !== priorityFilter.value) continue
    empty[q.status].push(q)
  }
  return empty
})

const total = computed(() =>
  campaign.value ? quests.forCampaign(campaign.value.id as CampaignId).length : 0,
)
const openCount = computed(() =>
  campaign.value ? quests.openFor(campaign.value.id as CampaignId).length : 0,
)

const draft = reactive<{ title: string; priority: (typeof QUEST_PRIORITIES)[number]; description: string }>({
  title: '',
  priority: 'normal',
  description: '',
})

const objectiveDraft = ref<Record<QuestId, string>>({})

const lastError = ref<string | null>(null)

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Quests' },
])

function addQuest(): void {
  if (!campaign.value) return
  try {
    quests.create({
      campaignId: campaign.value.id,
      title: draft.title,
      priority: draft.priority,
      description: draft.description,
    })
    draft.title = ''
    draft.description = ''
    lastError.value = null
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'something went wrong'
  }
}

function changeStatus(id: QuestId, status: QuestStatus): void {
  try {
    quests.setStatus(id, status)
    lastError.value = null
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'something went wrong'
  }
}

function addObjectiveTo(id: QuestId): void {
  const text = objectiveDraft.value[id] ?? ''
  if (!text.trim()) return
  quests.addObjective(id, text)
  objectiveDraft.value[id] = ''
}

function toggleObjective(id: QuestId, objectiveId: string): void {
  quests.toggleObjective(id, objectiveId)
}

function removeObjective(id: QuestId, objectiveId: string): void {
  quests.removeObjective(id, objectiveId)
}

function deleteQuest(id: QuestId): void {
  if (!window.confirm('Delete this quest?')) return
  quests.remove(id)
}
</script>

<template>
  <section class="container-wide py-8 space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Campaign not found</h2>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back</RouterLink>
    </div>

    <template v-else>
      <PageHeader
        title="Quests"
        :meta="openCount + ' open / ' + total + ' total'"
      />

      <SurfaceCard title="Filter">
        <label class="text-xs text-ink-500">
          Priority
          <select
            id="quest-priority-filter"
            v-model="priorityFilter"
            class="ml-2 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
          >
            <option value="any">any</option>
            <option v-for="p in QUEST_PRIORITIES" :key="p" :value="p">{{ priorityLabel(p) }}</option>
          </select>
        </label>
      </SurfaceCard>

      <SurfaceCard title="Add a quest">
        <form class="grid grid-cols-1 sm:grid-cols-3 gap-3" @submit.prevent="addQuest">
          <input
            id="quest-title"
            v-model="draft.title"
            type="text"
            placeholder="Title"
            class="sm:col-span-2 border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
          />
          <select v-model="draft.priority" class="border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white">
            <option v-for="p in QUEST_PRIORITIES" :key="p" :value="p">{{ priorityLabel(p) }}</option>
          </select>
          <textarea
            v-model="draft.description"
            rows="2"
            placeholder="Description"
            class="sm:col-span-3 border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
          />
          <div class="sm:col-span-3 flex justify-end">
            <BaseButton tone="primary" type="submit">Add quest</BaseButton>
          </div>
        </form>
        <p v-if="lastError" class="mt-2 text-sm text-crimson-600">{{ lastError }}</p>
      </SurfaceCard>

      <EmptyState
        v-if="total === 0"
        title="No quests yet"
        description="Add one above; you can track objectives and reward inside each."
      />

      <template v-else>
        <div v-for="status in QUEST_STATUSES" :key="status" v-show="grouped[status].length > 0" class="space-y-2">
          <h2 class="text-sm uppercase tracking-wider text-ink-400">
            {{ statusLabel(status) }} ({{ grouped[status].length }})
          </h2>
          <ul class="space-y-3">
            <li v-for="q in grouped[status]" :key="q.id" class="surface p-3">
              <header class="flex items-start justify-between gap-3">
                <div>
                  <h3 class="text-base font-display text-ink-900">{{ q.title }}</h3>
                  <p v-if="q.description" class="text-xs text-ink-500">{{ q.description }}</p>
                </div>
                <StatusBadge :tone="statusTone(q.status)">{{ statusLabel(q.status) }}</StatusBadge>
              </header>

              <div class="mt-2">
                <ObjectiveBar :quest="q" />
              </div>

              <ul v-if="q.objectives.length > 0" class="mt-1 text-sm">
                <li v-for="o in q.objectives" :key="o.id" class="flex items-center gap-2">
                  <input
                    type="checkbox"
                    :checked="o.completed"
                    @change="toggleObjective(q.id, o.id)"
                  />
                  <span :class="o.completed ? 'line-through text-ink-400' : 'text-ink-800'">
                    {{ o.text }}
                  </span>
                  <button
                    class="ml-auto text-xs text-crimson-600 hover:text-crimson-800"
                    @click="removeObjective(q.id, o.id)"
                  >
                    remove
                  </button>
                </li>
              </ul>

              <form class="mt-2 flex gap-2" @submit.prevent="addObjectiveTo(q.id)">
                <input
                  v-model="objectiveDraft[q.id]"
                  type="text"
                  placeholder="Add an objective"
                  class="flex-1 border border-parchment-300 rounded-soft px-2 py-1 text-xs bg-white"
                />
                <BaseButton size="sm" type="submit">add</BaseButton>
              </form>

              <footer class="mt-3 flex flex-wrap gap-1 text-xs">
                <button
                  v-for="s in QUEST_STATUSES"
                  :key="s"
                  type="button"
                  class="px-2 py-1 rounded-soft"
                  :class="q.status === s ? 'bg-ink-700 text-white' : 'bg-parchment-100 text-ink-700 hover:bg-parchment-200'"
                  @click="changeStatus(q.id, s)"
                >
                  {{ statusLabel(s) }}
                </button>
                <button
                  type="button"
                  class="ml-auto text-xs text-crimson-600 hover:text-crimson-800"
                  @click="deleteQuest(q.id)"
                >
                  delete
                </button>
              </footer>
            </li>
          </ul>
        </div>
      </template>
    </template>
  </section>
</template>

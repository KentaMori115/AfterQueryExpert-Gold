<script setup lang="ts">
import { computed, ref } from 'vue'

import type { CampaignId } from '@core/ids'
import type { Tag, TagTargetKind } from '@core/models/tag'
import { slugifyTagName } from '@core/models/tag'

import { useTagStore } from '../store'

import TagChip from './TagChip.vue'

const props = defineProps<{
  campaignId: CampaignId
  kind: TagTargetKind
  targetId: string
}>()

const tags = useTagStore()

const draftName = ref('')
const lastError = ref<string | null>(null)

const attached = computed<Tag[]>(() => tags.forTarget(props.campaignId, props.kind, props.targetId))
const attachedIds = computed(() => new Set(attached.value.map((t) => t.id)))
const available = computed<Tag[]>(() =>
  tags.forCampaign(props.campaignId).filter((t) => !attachedIds.value.has(t.id)),
)

const draftSlug = computed(() => slugifyTagName(draftName.value))
const draftMatchesExisting = computed(() =>
  tags.forCampaign(props.campaignId).some((t) => t.slug === draftSlug.value),
)

function attachExisting(tag: Tag): void {
  try {
    tags.attach(tag.id, props.kind, props.targetId)
    lastError.value = null
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'attach failed'
  }
}

function detach(tag: Tag): void {
  tags.detach(tag.id, props.kind, props.targetId)
}

function createAndAttach(): void {
  const name = draftName.value.trim()
  if (name.length === 0) return
  try {
    const created = tags.create({ campaignId: props.campaignId, name })
    tags.attach(created.id, props.kind, props.targetId)
    draftName.value = ''
    lastError.value = null
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'create failed'
  }
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap gap-1.5">
      <TagChip
        v-for="tag in attached"
        :key="tag.id"
        :tag="tag"
        :removable="true"
        @remove="detach(tag)"
      />
      <span v-if="attached.length === 0" class="text-xs italic text-ink-500">no tags yet</span>
    </div>

    <form class="flex gap-2" @submit.prevent="createAndAttach">
      <input
        v-model="draftName"
        type="text"
        :placeholder="draftMatchesExisting ? 'pick an existing tag below' : 'add a tag'"
        class="flex-1 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
      />
      <button
        type="submit"
        class="px-2 py-1 text-xs rounded-soft bg-ink-700 text-white disabled:opacity-50"
        :disabled="draftName.trim().length === 0 || draftMatchesExisting"
      >
        add
      </button>
    </form>

    <div v-if="available.length > 0" class="flex flex-wrap gap-1.5">
      <span class="text-xs uppercase tracking-wide text-ink-500 mr-1 self-center">existing</span>
      <TagChip
        v-for="tag in available.slice(0, 12)"
        :key="tag.id"
        :tag="tag"
        :interactive="true"
        @pick="attachExisting(tag)"
      />
    </div>

    <p v-if="lastError" class="text-xs text-crimson-600">{{ lastError }}</p>
  </div>
</template>

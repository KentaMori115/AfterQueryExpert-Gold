<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import type { CampaignId, LocationId } from '@core/ids'
import {
  LOCATION_KINDS,
  kindLabel,
  type Location,
  type LocationDraftInput,
  locationDraftSchema,
} from '@core/models/location'
import BaseButton from '@ui/primitives/BaseButton.vue'

interface DraftShape {
  campaignId: CampaignId
  parentId: LocationId | null
  name: string
  kind: typeof LOCATION_KINDS[number]
  shortDescription: string
  notes: string
  visited: boolean
}

const props = withDefaults(
  defineProps<{
    campaignId: CampaignId
    initial?: Partial<LocationDraftInput>
    parents?: ReadonlyArray<Location>
    forbidParentId?: LocationId
    submitLabel?: string
    cancelLabel?: string
    busy?: boolean
  }>(),
  {
    initial: () => ({}),
    parents: () => [],
    forbidParentId: undefined,
    submitLabel: 'Save',
    cancelLabel: 'Cancel',
    busy: false,
  },
)

const emit = defineEmits<{
  (e: 'submit', value: LocationDraftInput): void
  (e: 'cancel'): void
}>()

const draft = reactive<DraftShape>({
  campaignId: (props.initial.campaignId ?? props.campaignId) as CampaignId,
  parentId: (props.initial.parentId ?? null) as LocationId | null,
  name: props.initial.name ?? '',
  kind: (props.initial.kind ?? 'region') as DraftShape['kind'],
  shortDescription: props.initial.shortDescription ?? '',
  notes: props.initial.notes ?? '',
  visited: props.initial.visited ?? false,
})

const issues = ref<Record<string, string>>({})

const parentOptions = computed(() => {
  return props.parents.filter((p) => p.id !== props.forbidParentId)
})

function handleSubmit(): void {
  const parsed = locationDraftSchema.safeParse({
    ...draft,
    parentId: draft.parentId || null,
  })
  if (!parsed.success) {
    const next: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '_')
      if (!next[key]) next[key] = issue.message
    }
    issues.value = next
    return
  }
  issues.value = {}
  emit('submit', parsed.data)
}

function fieldClass(name: string): string {
  const base = 'w-full border rounded-soft px-3 py-2 text-sm bg-white'
  return issues.value[name]
    ? `${base} border-crimson-500 focus:outline-crimson-500`
    : `${base} border-parchment-300 focus:outline-ember-500`
}
</script>

<template>
  <form class="space-y-4" novalidate @submit.prevent="handleSubmit">
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div class="sm:col-span-2">
        <label class="block text-sm text-ink-700 mb-1" for="location-name">Name</label>
        <input
          id="location-name"
          v-model="draft.name"
          type="text"
          autocomplete="off"
          :class="fieldClass('name')"
        />
        <p v-if="issues.name" class="mt-1 text-xs text-crimson-600">{{ issues.name }}</p>
      </div>
      <div>
        <label class="block text-sm text-ink-700 mb-1" for="location-kind">Kind</label>
        <select id="location-kind" v-model="draft.kind" :class="fieldClass('kind')">
          <option v-for="k in LOCATION_KINDS" :key="k" :value="k">{{ kindLabel(k) }}</option>
        </select>
      </div>
    </div>

    <div>
      <label class="block text-sm text-ink-700 mb-1" for="location-parent">Parent location</label>
      <select id="location-parent" v-model="draft.parentId" :class="fieldClass('parentId')">
        <option :value="null">(no parent - top-level)</option>
        <option v-for="p in parentOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </div>

    <div>
      <label class="block text-sm text-ink-700 mb-1" for="location-short">Short description</label>
      <input
        id="location-short"
        v-model="draft.shortDescription"
        type="text"
        :class="fieldClass('shortDescription')"
      />
    </div>

    <div>
      <label class="block text-sm text-ink-700 mb-1" for="location-notes">Notes</label>
      <textarea
        id="location-notes"
        v-model="draft.notes"
        rows="5"
        :class="fieldClass('notes')"
      />
    </div>

    <label class="flex items-center gap-2 text-sm text-ink-700">
      <input v-model="draft.visited" type="checkbox" />
      The party has been here
    </label>

    <div class="flex items-center justify-end gap-2 pt-2">
      <BaseButton tone="ghost" type="button" :disabled="busy" @click="emit('cancel')">
        {{ cancelLabel }}
      </BaseButton>
      <BaseButton tone="primary" type="submit" :disabled="busy">
        {{ submitLabel }}
      </BaseButton>
    </div>
  </form>
</template>

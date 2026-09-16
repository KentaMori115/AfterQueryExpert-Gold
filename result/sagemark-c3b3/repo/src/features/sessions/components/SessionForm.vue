<script setup lang="ts">
import { reactive, ref } from 'vue'

import type { CampaignId, LocationId } from '@core/ids'
import {
  type SessionDraftInput,
  sessionDraftSchema,
} from '@core/models/session'
import BaseButton from '@ui/primitives/BaseButton.vue'

interface DraftShape {
  campaignId: CampaignId
  title: string
  playedAt: string
  durationMinutes: number
  locationId: LocationId | null
  summary: string
}

const props = withDefaults(
  defineProps<{
    campaignId: CampaignId
    initial?: Partial<SessionDraftInput>
    submitLabel?: string
    cancelLabel?: string
    busy?: boolean
  }>(),
  {
    initial: () => ({}),
    submitLabel: 'Save',
    cancelLabel: 'Cancel',
    busy: false,
  },
)

const emit = defineEmits<{
  (e: 'submit', value: SessionDraftInput): void
  (e: 'cancel'): void
}>()

function defaultDate(): string {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  return d.toISOString().slice(0, 16)
}

function isoToInputValue(iso?: string): string {
  if (!iso) return defaultDate()
  // Datetime-local input wants YYYY-MM-DDTHH:mm
  return iso.slice(0, 16)
}

const draft = reactive<DraftShape>({
  campaignId: (props.initial.campaignId ?? props.campaignId) as CampaignId,
  title: props.initial.title ?? '',
  playedAt: isoToInputValue(props.initial.playedAt as string | undefined),
  durationMinutes: props.initial.durationMinutes ?? 180,
  locationId: (props.initial.locationId ?? null) as LocationId | null,
  summary: props.initial.summary ?? '',
})

const issues = ref<Record<string, string>>({})

function handleSubmit(): void {
  const parsed = sessionDraftSchema.safeParse({
    ...draft,
    durationMinutes: Number(draft.durationMinutes),
    playedAt: new Date(draft.playedAt).toISOString(),
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
    <div>
      <label class="block text-sm text-ink-700 mb-1" for="session-title">Title</label>
      <input
        id="session-title"
        v-model="draft.title"
        type="text"
        autocomplete="off"
        :class="fieldClass('title')"
      />
      <p v-if="issues.title" class="mt-1 text-xs text-crimson-600">{{ issues.title }}</p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label class="block text-sm text-ink-700 mb-1" for="session-played-at">Played</label>
        <input
          id="session-played-at"
          v-model="draft.playedAt"
          type="datetime-local"
          :class="fieldClass('playedAt')"
        />
        <p v-if="issues.playedAt" class="mt-1 text-xs text-crimson-600">{{ issues.playedAt }}</p>
      </div>
      <div>
        <label class="block text-sm text-ink-700 mb-1" for="session-duration">Duration (minutes)</label>
        <input
          id="session-duration"
          v-model.number="draft.durationMinutes"
          type="number"
          min="0"
          step="15"
          :class="fieldClass('durationMinutes')"
        />
      </div>
    </div>

    <div>
      <label class="block text-sm text-ink-700 mb-1" for="session-summary">Summary</label>
      <textarea
        id="session-summary"
        v-model="draft.summary"
        rows="3"
        :class="fieldClass('summary')"
      />
    </div>

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

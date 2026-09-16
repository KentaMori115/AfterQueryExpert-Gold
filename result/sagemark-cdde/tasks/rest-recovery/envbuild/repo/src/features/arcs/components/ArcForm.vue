<script setup lang="ts">
import { reactive, ref } from 'vue'

import type { CampaignId } from '@core/ids'
import {
  ARC_STATUSES,
  ARC_TENSIONS,
  type ArcDraftInput,
  arcDraftSchema,
  statusLabel,
  tensionLabel,
} from '@core/models/arc'
import BaseButton from '@ui/primitives/BaseButton.vue'

interface DraftShape {
  campaignId: CampaignId
  title: string
  synopsis: string
  status: typeof ARC_STATUSES[number]
  tension: typeof ARC_TENSIONS[number]
  notes: string
}

const props = withDefaults(
  defineProps<{
    campaignId: CampaignId
    initial?: Partial<ArcDraftInput>
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
  (e: 'submit', value: ArcDraftInput): void
  (e: 'cancel'): void
}>()

const draft = reactive<DraftShape>({
  campaignId: (props.initial.campaignId ?? props.campaignId) as CampaignId,
  title: props.initial.title ?? '',
  synopsis: props.initial.synopsis ?? '',
  status: (props.initial.status ?? 'seeded') as DraftShape['status'],
  tension: (props.initial.tension ?? 'low') as DraftShape['tension'],
  notes: props.initial.notes ?? '',
})

const issues = ref<Record<string, string>>({})

function handleSubmit(): void {
  const parsed = arcDraftSchema.safeParse(draft)
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
      <label class="block text-sm text-ink-700 mb-1" for="arc-title">Title</label>
      <input
        id="arc-title"
        v-model="draft.title"
        type="text"
        autocomplete="off"
        :class="fieldClass('title')"
      />
      <p v-if="issues.title" class="mt-1 text-xs text-crimson-600">{{ issues.title }}</p>
    </div>

    <div>
      <label class="block text-sm text-ink-700 mb-1" for="arc-synopsis">Synopsis</label>
      <textarea id="arc-synopsis" v-model="draft.synopsis" rows="3" :class="fieldClass('synopsis')" />
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label class="block text-sm text-ink-700 mb-1" for="arc-status">Status</label>
        <select id="arc-status" v-model="draft.status" :class="fieldClass('status')">
          <option v-for="s in ARC_STATUSES" :key="s" :value="s">{{ statusLabel(s) }}</option>
        </select>
      </div>
      <div>
        <label class="block text-sm text-ink-700 mb-1" for="arc-tension">Tension</label>
        <select id="arc-tension" v-model="draft.tension" :class="fieldClass('tension')">
          <option v-for="t in ARC_TENSIONS" :key="t" :value="t">{{ tensionLabel(t) }}</option>
        </select>
      </div>
    </div>

    <div>
      <label class="block text-sm text-ink-700 mb-1" for="arc-notes">Notes</label>
      <textarea id="arc-notes" v-model="draft.notes" rows="5" :class="fieldClass('notes')" />
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

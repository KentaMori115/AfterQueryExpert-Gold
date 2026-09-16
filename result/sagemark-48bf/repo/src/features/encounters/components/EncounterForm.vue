<script setup lang="ts">
import { reactive, ref } from 'vue'

import type { CampaignId } from '@core/ids'
import {
  ENCOUNTER_DIFFICULTIES,
  ENCOUNTER_KINDS,
  type EncounterDraftInput,
  difficultyLabel,
  encounterDraftSchema,
  kindLabel,
} from '@core/models/encounter'
import BaseButton from '@ui/primitives/BaseButton.vue'

interface DraftShape {
  campaignId: CampaignId
  title: string
  kind: typeof ENCOUNTER_KINDS[number]
  difficulty: typeof ENCOUNTER_DIFFICULTIES[number]
  summary: string
  resolved: boolean
}

const props = withDefaults(
  defineProps<{
    campaignId: CampaignId
    initial?: Partial<EncounterDraftInput>
    submitLabel?: string
    cancelLabel?: string
    busy?: boolean
  }>(),
  { initial: () => ({}), submitLabel: 'Save', cancelLabel: 'Cancel', busy: false },
)

const emit = defineEmits<{
  (e: 'submit', value: EncounterDraftInput): void
  (e: 'cancel'): void
}>()

const draft = reactive<DraftShape>({
  campaignId: (props.initial.campaignId ?? props.campaignId) as CampaignId,
  title: props.initial.title ?? '',
  kind: (props.initial.kind ?? 'combat') as DraftShape['kind'],
  difficulty: (props.initial.difficulty ?? 'medium') as DraftShape['difficulty'],
  summary: props.initial.summary ?? '',
  resolved: props.initial.resolved ?? false,
})

const issues = ref<Record<string, string>>({})

function handleSubmit(): void {
  const parsed = encounterDraftSchema.safeParse(draft)
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
      <label class="block text-sm text-ink-700 mb-1" for="encounter-title">Title</label>
      <input
        id="encounter-title"
        v-model="draft.title"
        type="text"
        autocomplete="off"
        :class="fieldClass('title')"
      />
      <p v-if="issues.title" class="mt-1 text-xs text-crimson-600">{{ issues.title }}</p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label class="block text-sm text-ink-700 mb-1" for="encounter-kind">Kind</label>
        <select id="encounter-kind" v-model="draft.kind" :class="fieldClass('kind')">
          <option v-for="k in ENCOUNTER_KINDS" :key="k" :value="k">{{ kindLabel(k) }}</option>
        </select>
      </div>
      <div>
        <label class="block text-sm text-ink-700 mb-1" for="encounter-difficulty">Difficulty</label>
        <select id="encounter-difficulty" v-model="draft.difficulty" :class="fieldClass('difficulty')">
          <option v-for="d in ENCOUNTER_DIFFICULTIES" :key="d" :value="d">{{ difficultyLabel(d) }}</option>
        </select>
      </div>
    </div>

    <div>
      <label class="block text-sm text-ink-700 mb-1" for="encounter-summary">Summary</label>
      <textarea id="encounter-summary" v-model="draft.summary" rows="4" :class="fieldClass('summary')" />
    </div>

    <label class="flex items-center gap-2 text-sm text-ink-700">
      <input v-model="draft.resolved" type="checkbox" />
      Already resolved
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

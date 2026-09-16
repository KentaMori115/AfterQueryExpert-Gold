<script setup lang="ts">
import { reactive, ref } from 'vue'

import type { CampaignId } from '@core/ids'
import {
  FACTION_ALIGNMENTS,
  FACTION_SCOPES,
  type FactionDraftInput,
  alignmentLabel,
  factionDraftSchema,
  scopeLabel,
} from '@core/models/faction'
import BaseButton from '@ui/primitives/BaseButton.vue'

interface DraftShape {
  campaignId: CampaignId
  name: string
  motto: string
  description: string
  alignment: typeof FACTION_ALIGNMENTS[number]
  scope: typeof FACTION_SCOPES[number]
  influence: number
  active: boolean
}

const props = withDefaults(
  defineProps<{
    campaignId: CampaignId
    initial?: Partial<FactionDraftInput>
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
  (e: 'submit', value: FactionDraftInput): void
  (e: 'cancel'): void
}>()

const draft = reactive<DraftShape>({
  campaignId: (props.initial.campaignId ?? props.campaignId) as CampaignId,
  name: props.initial.name ?? '',
  motto: props.initial.motto ?? '',
  description: props.initial.description ?? '',
  alignment: (props.initial.alignment ?? 'unknown') as DraftShape['alignment'],
  scope: (props.initial.scope ?? 'regional') as DraftShape['scope'],
  influence: props.initial.influence ?? 25,
  active: props.initial.active ?? true,
})

const issues = ref<Record<string, string>>({})

function handleSubmit(): void {
  const parsed = factionDraftSchema.safeParse({
    ...draft,
    influence: Number(draft.influence),
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
      <label class="block text-sm text-ink-700 mb-1" for="faction-name">Name</label>
      <input
        id="faction-name"
        v-model="draft.name"
        type="text"
        autocomplete="off"
        :class="fieldClass('name')"
        :aria-invalid="!!issues.name"
      />
      <p v-if="issues.name" class="mt-1 text-xs text-crimson-600">{{ issues.name }}</p>
    </div>

    <div>
      <label class="block text-sm text-ink-700 mb-1" for="faction-motto">Motto</label>
      <input id="faction-motto" v-model="draft.motto" type="text" :class="fieldClass('motto')" />
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label class="block text-sm text-ink-700 mb-1" for="faction-alignment">Alignment</label>
        <select id="faction-alignment" v-model="draft.alignment" :class="fieldClass('alignment')">
          <option v-for="a in FACTION_ALIGNMENTS" :key="a" :value="a">{{ alignmentLabel(a) }}</option>
        </select>
      </div>
      <div>
        <label class="block text-sm text-ink-700 mb-1" for="faction-scope">Scope</label>
        <select id="faction-scope" v-model="draft.scope" :class="fieldClass('scope')">
          <option v-for="s in FACTION_SCOPES" :key="s" :value="s">{{ scopeLabel(s) }}</option>
        </select>
      </div>
    </div>

    <div>
      <label class="block text-sm text-ink-700 mb-1" for="faction-influence">
        Influence ({{ draft.influence }})
      </label>
      <input
        id="faction-influence"
        v-model.number="draft.influence"
        type="range"
        min="0"
        max="100"
        step="1"
        class="w-full accent-ember-500"
      />
      <p v-if="issues.influence" class="mt-1 text-xs text-crimson-600">{{ issues.influence }}</p>
    </div>

    <div>
      <label class="block text-sm text-ink-700 mb-1" for="faction-description">Notes</label>
      <textarea
        id="faction-description"
        v-model="draft.description"
        rows="4"
        :class="fieldClass('description')"
      />
    </div>

    <label class="flex items-center gap-2 text-sm text-ink-700">
      <input v-model="draft.active" type="checkbox" />
      Still in play
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

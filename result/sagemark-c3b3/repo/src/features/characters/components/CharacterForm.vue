<script setup lang="ts">
import { reactive, ref } from 'vue'

import type { CampaignId } from '@core/ids'
import {
  CHARACTER_DISPOSITIONS,
  CHARACTER_KINDS,
  type CharacterDraftInput,
  characterDraftSchema,
  dispositionLabel,
  kindLabel,
} from '@core/models/character'
import BaseButton from '@ui/primitives/BaseButton.vue'

interface DraftShape {
  campaignId: CampaignId
  kind: 'pc' | 'npc'
  name: string
  pronouns: string
  ancestry: string
  vocation: string
  level: number
  disposition: typeof CHARACTER_DISPOSITIONS[number]
  blurb: string
  alive: boolean
}

const props = withDefaults(
  defineProps<{
    campaignId: CampaignId
    initial?: Partial<CharacterDraftInput>
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
  (e: 'submit', value: CharacterDraftInput): void
  (e: 'cancel'): void
}>()

const draft = reactive<DraftShape>({
  campaignId: (props.initial.campaignId ?? props.campaignId) as CampaignId,
  kind: (props.initial.kind as 'pc' | 'npc') ?? 'npc',
  name: props.initial.name ?? '',
  pronouns: props.initial.pronouns ?? '',
  ancestry: props.initial.ancestry ?? '',
  vocation: props.initial.vocation ?? '',
  level: props.initial.level ?? 1,
  disposition: (props.initial.disposition ?? 'unknown') as DraftShape['disposition'],
  blurb: props.initial.blurb ?? '',
  alive: props.initial.alive ?? true,
})

const issues = ref<Record<string, string>>({})

function handleSubmit(): void {
  const parsed = characterDraftSchema.safeParse({
    ...draft,
    level: Number(draft.level),
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
        <label class="block text-sm text-ink-700 mb-1" for="character-name">Name</label>
        <input
          id="character-name"
          v-model="draft.name"
          type="text"
          autocomplete="off"
          :class="fieldClass('name')"
          :aria-invalid="!!issues.name"
        />
        <p v-if="issues.name" class="mt-1 text-xs text-crimson-600">{{ issues.name }}</p>
      </div>
      <div>
        <label class="block text-sm text-ink-700 mb-1" for="character-kind">Kind</label>
        <select id="character-kind" v-model="draft.kind" :class="fieldClass('kind')">
          <option v-for="k in CHARACTER_KINDS" :key="k" :value="k">{{ kindLabel(k) }}</option>
        </select>
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div>
        <label class="block text-sm text-ink-700 mb-1" for="character-pronouns">Pronouns</label>
        <input id="character-pronouns" v-model="draft.pronouns" type="text" :class="fieldClass('pronouns')" />
      </div>
      <div>
        <label class="block text-sm text-ink-700 mb-1" for="character-ancestry">Ancestry</label>
        <input id="character-ancestry" v-model="draft.ancestry" type="text" :class="fieldClass('ancestry')" />
      </div>
      <div>
        <label class="block text-sm text-ink-700 mb-1" for="character-vocation">Vocation</label>
        <input id="character-vocation" v-model="draft.vocation" type="text" :class="fieldClass('vocation')" />
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div>
        <label class="block text-sm text-ink-700 mb-1" for="character-level">Level</label>
        <input
          id="character-level"
          v-model.number="draft.level"
          type="number"
          min="0"
          max="40"
          :class="fieldClass('level')"
        />
        <p v-if="issues.level" class="mt-1 text-xs text-crimson-600">{{ issues.level }}</p>
      </div>
      <div>
        <label class="block text-sm text-ink-700 mb-1" for="character-disposition">Disposition</label>
        <select id="character-disposition" v-model="draft.disposition" :class="fieldClass('disposition')">
          <option v-for="d in CHARACTER_DISPOSITIONS" :key="d" :value="d">{{ dispositionLabel(d) }}</option>
        </select>
      </div>
      <div class="flex items-end">
        <label class="flex items-center gap-2 text-sm text-ink-700">
          <input v-model="draft.alive" type="checkbox" />
          Still alive
        </label>
      </div>
    </div>

    <div>
      <label class="block text-sm text-ink-700 mb-1" for="character-blurb">Notes</label>
      <textarea
        id="character-blurb"
        v-model="draft.blurb"
        rows="4"
        :class="fieldClass('blurb')"
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

<script setup lang="ts">
import { reactive, ref } from 'vue'

import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_SYSTEMS,
  type CampaignDraftInput,
  campaignDraftSchema,
  statusLabel,
  systemLabel,
} from '@core/models/campaign'
import BaseButton from '@ui/primitives/BaseButton.vue'

interface Props {
  initial?: CampaignDraftInput
  submitLabel?: string
  cancelLabel?: string
  busy?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  initial: () => ({ name: '', tagline: '', system: 'custom', status: 'planning' }),
  submitLabel: 'Save',
  cancelLabel: 'Cancel',
  busy: false,
})

const emit = defineEmits<{
  (e: 'submit', value: CampaignDraftInput): void
  (e: 'cancel'): void
}>()

const draft = reactive<Required<CampaignDraftInput>>({
  name: props.initial.name ?? '',
  tagline: props.initial.tagline ?? '',
  system: props.initial.system ?? 'custom',
  status: props.initial.status ?? 'planning',
})

const issues = ref<Record<string, string>>({})

function handleSubmit(): void {
  const parsed = campaignDraftSchema.safeParse(draft)
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

function fieldClass(name: keyof typeof draft): string {
  const base = 'w-full border rounded-soft px-3 py-2 text-sm bg-white'
  return issues.value[name as string]
    ? `${base} border-crimson-500 focus:outline-crimson-500`
    : `${base} border-parchment-300 focus:outline-ember-500`
}
</script>

<template>
  <form class="space-y-4" novalidate @submit.prevent="handleSubmit">
    <div>
      <label class="block text-sm text-ink-700 mb-1" for="campaign-name">Name</label>
      <input
        id="campaign-name"
        v-model="draft.name"
        type="text"
        autocomplete="off"
        :class="fieldClass('name')"
        :aria-invalid="!!issues.name"
        :aria-describedby="issues.name ? 'campaign-name-error' : undefined"
      />
      <p
        v-if="issues.name"
        id="campaign-name-error"
        class="mt-1 text-xs text-crimson-600"
      >
        {{ issues.name }}
      </p>
    </div>

    <div>
      <label class="block text-sm text-ink-700 mb-1" for="campaign-tagline">Tagline</label>
      <input
        id="campaign-tagline"
        v-model="draft.tagline"
        type="text"
        autocomplete="off"
        :class="fieldClass('tagline')"
      />
      <p v-if="issues.tagline" class="mt-1 text-xs text-crimson-600">{{ issues.tagline }}</p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label class="block text-sm text-ink-700 mb-1" for="campaign-system">System</label>
        <select id="campaign-system" v-model="draft.system" :class="fieldClass('system')">
          <option v-for="s in CAMPAIGN_SYSTEMS" :key="s" :value="s">{{ systemLabel(s) }}</option>
        </select>
      </div>
      <div>
        <label class="block text-sm text-ink-700 mb-1" for="campaign-status">Status</label>
        <select id="campaign-status" v-model="draft.status" :class="fieldClass('status')">
          <option v-for="st in CAMPAIGN_STATUSES" :key="st" :value="st">{{ statusLabel(st) }}</option>
        </select>
      </div>
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

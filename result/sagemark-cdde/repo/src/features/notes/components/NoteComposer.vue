<script setup lang="ts">
import { reactive, ref } from 'vue'

import {
  NOTE_PRIORITIES,
  type NoteDraftInput,
  type NoteTarget,
  noteDraftSchema,
  priorityLabel,
} from '@core/models/note'
import BaseButton from '@ui/primitives/BaseButton.vue'

const props = defineProps<{
  campaignId: string
  target: NoteTarget
  initial?: Partial<NoteDraftInput>
  submitLabel?: string
  cancelLabel?: string
  busy?: boolean
}>()

const emit = defineEmits<{
  (e: 'submit', value: NoteDraftInput): void
  (e: 'cancel'): void
}>()

interface DraftShape {
  title: string
  body: string
  priority: (typeof NOTE_PRIORITIES)[number]
  pinned: boolean
  remindAt: string
}

const draft = reactive<DraftShape>({
  title: props.initial?.title ?? '',
  body: props.initial?.body ?? '',
  priority: (props.initial?.priority ?? 'normal') as DraftShape['priority'],
  pinned: props.initial?.pinned ?? false,
  remindAt: (props.initial?.remindAt as string | undefined) ?? '',
})

const issues = ref<Record<string, string>>({})

function handleSubmit(): void {
  const payload: NoteDraftInput = {
    campaignId: props.campaignId,
    target: props.target,
    title: draft.title || undefined,
    body: draft.body,
    priority: draft.priority,
    pinned: draft.pinned,
    remindAt: draft.remindAt ? new Date(draft.remindAt).toISOString() : null,
  }
  const parsed = noteDraftSchema.safeParse(payload)
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
  <form class="space-y-3" novalidate @submit.prevent="handleSubmit">
    <div>
      <label class="block text-xs text-ink-500" for="note-title">Title (optional)</label>
      <input
        id="note-title"
        v-model="draft.title"
        type="text"
        :class="fieldClass('title')"
      />
    </div>
    <div>
      <label class="block text-xs text-ink-500" for="note-body">Body</label>
      <textarea
        id="note-body"
        v-model="draft.body"
        rows="4"
        :class="fieldClass('body')"
        placeholder="What needs remembering?"
      />
      <p v-if="issues.body" class="mt-1 text-xs text-crimson-600">{{ issues.body }}</p>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <label class="text-xs text-ink-500">
        Priority
        <select
          id="note-priority"
          v-model="draft.priority"
          :class="fieldClass('priority')"
        >
          <option v-for="p in NOTE_PRIORITIES" :key="p" :value="p">{{ priorityLabel(p) }}</option>
        </select>
      </label>
      <label class="text-xs text-ink-500">
        Remind me on (optional)
        <input
          id="note-remind"
          v-model="draft.remindAt"
          type="datetime-local"
          :class="fieldClass('remindAt')"
        />
      </label>
      <label class="flex items-end gap-2 text-sm text-ink-700">
        <input v-model="draft.pinned" type="checkbox" />
        Pin to the top
      </label>
    </div>
    <div class="flex items-center justify-end gap-2">
      <BaseButton tone="ghost" type="button" :disabled="busy" @click="emit('cancel')">
        {{ cancelLabel ?? 'Cancel' }}
      </BaseButton>
      <BaseButton tone="primary" type="submit" :disabled="busy">
        {{ submitLabel ?? 'Save note' }}
      </BaseButton>
    </div>
  </form>
</template>

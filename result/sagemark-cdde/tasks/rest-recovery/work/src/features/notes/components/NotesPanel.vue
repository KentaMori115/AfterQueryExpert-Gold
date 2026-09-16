<script setup lang="ts">
import { computed, ref } from 'vue'

import type { CampaignId, NoteId } from '@core/ids'
import {
  type Note,
  type NoteDraftInput,
  type NoteTarget,
  compareNotesForListing,
  isOverdue,
  priorityLabel,
  priorityTone,
} from '@core/models/note'
import { relativeFromNow } from '@core/time/timestamps'
import { useNoteStore } from '../store'

import BaseButton from '@ui/primitives/BaseButton.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import MarkdownView from '@ui/primitives/MarkdownView.vue'
import NoteComposer from './NoteComposer.vue'

const props = defineProps<{
  campaignId: CampaignId
  target: NoteTarget
  title?: string
  hideWhenEmpty?: boolean
}>()

const notes = useNoteStore()
const composing = ref(false)
const editingId = ref<NoteId | null>(null)

const targetNotes = computed<Note[]>(() => {
  const list = notes.forTarget(props.campaignId, props.target)
  return [...list].sort(compareNotesForListing)
})

const visible = computed(() => {
  if (!props.hideWhenEmpty) return true
  return targetNotes.value.length > 0 || composing.value || editingId.value !== null
})

function startCompose(): void {
  editingId.value = null
  composing.value = true
}

function startEdit(note: Note): void {
  composing.value = false
  editingId.value = note.id
}

function cancelCompose(): void {
  composing.value = false
  editingId.value = null
}

function submit(draft: NoteDraftInput): void {
  if (editingId.value) {
    notes.update(editingId.value, draft)
  } else {
    notes.create(draft)
  }
  cancelCompose()
}

function toggleResolved(note: Note): void {
  if (note.resolvedAt) notes.reopen(note.id)
  else notes.resolve(note.id)
}

function togglePinned(note: Note): void {
  notes.setPinned(note.id, !note.pinned)
}

function removeNote(id: NoteId): void {
  if (!window.confirm('Delete this note?')) return
  if (editingId.value === id) cancelCompose()
  notes.remove(id)
}

function relativeUpdated(note: Note): string {
  return relativeFromNow(note.updatedAt)
}

function initialFor(note: Note): NoteDraftInput {
  return {
    campaignId: note.campaignId,
    target: note.target,
    title: note.title,
    body: note.body,
    priority: note.priority,
    pinned: note.pinned,
    remindAt: note.remindAt,
  }
}
</script>

<template>
  <section v-if="visible" class="space-y-3">
    <header class="flex items-center justify-between">
      <h3 class="text-sm uppercase tracking-wider text-ink-400">{{ title ?? 'Notes' }}</h3>
      <BaseButton v-if="!composing && editingId === null" size="sm" @click="startCompose">
        Add note
      </BaseButton>
    </header>

    <div v-if="composing" class="surface p-3">
      <NoteComposer
        :campaign-id="campaignId"
        :target="target"
        submit-label="Save"
        @submit="submit"
        @cancel="cancelCompose"
      />
    </div>

    <ul v-if="targetNotes.length > 0" class="space-y-2">
      <li
        v-for="note in targetNotes"
        :key="note.id"
        class="surface p-3"
        :class="note.resolvedAt ? 'opacity-60' : ''"
      >
        <div v-if="editingId === note.id">
          <NoteComposer
            :campaign-id="campaignId"
            :target="target"
            :initial="initialFor(note)"
            submit-label="Update"
            @submit="submit"
            @cancel="cancelCompose"
          />
        </div>
        <template v-else>
          <header class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <h4 v-if="note.title" class="text-sm font-display text-ink-900">{{ note.title }}</h4>
              <p class="text-xs text-ink-400">
                updated {{ relativeUpdated(note) }}<span v-if="note.pinned"> &middot; pinned</span>
              </p>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
              <StatusBadge :tone="priorityTone(note.priority)">{{ priorityLabel(note.priority) }}</StatusBadge>
              <StatusBadge v-if="note.resolvedAt" tone="neutral">Done</StatusBadge>
              <StatusBadge v-else-if="isOverdue(note)" tone="danger">Overdue</StatusBadge>
            </div>
          </header>
          <div class="mt-2 text-sm text-ink-700">
            <MarkdownView :source="note.body" empty="" />
          </div>
          <footer class="mt-2 flex flex-wrap gap-2 text-xs">
            <button class="text-ink-600 hover:text-ink-900" @click="startEdit(note)">edit</button>
            <button class="text-ink-600 hover:text-ink-900" @click="togglePinned(note)">
              {{ note.pinned ? 'unpin' : 'pin' }}
            </button>
            <button class="text-ink-600 hover:text-ink-900" @click="toggleResolved(note)">
              {{ note.resolvedAt ? 'reopen' : 'mark done' }}
            </button>
            <button class="ml-auto text-crimson-600 hover:text-crimson-800" @click="removeNote(note.id)">
              delete
            </button>
          </footer>
        </template>
      </li>
    </ul>
    <p v-else-if="!composing" class="text-xs text-ink-400">No notes yet for this entry.</p>
  </section>
</template>

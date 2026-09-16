<script setup lang="ts">
import { computed } from 'vue'

import {
  type Session,
  durationLabel,
  sessionLabel,
} from '@core/models/session'
import { pluralize } from '@core/lib/format'
import { format } from 'date-fns'

const props = defineProps<{
  session: Session
}>()

const playedOn = computed(() => format(new Date(props.session.playedAt), 'PPP'))
const attendeeCount = computed(() => props.session.attendees.length)
</script>

<template>
  <article class="surface p-4">
    <header class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 class="text-base font-display text-ink-900 truncate">
          {{ sessionLabel(session) }}
        </h3>
        <p class="text-xs text-ink-400">{{ playedOn }}</p>
      </div>
      <div class="text-right text-xs text-ink-500 shrink-0">
        <div>{{ durationLabel(session.durationMinutes) }}</div>
        <div>{{ pluralize(attendeeCount, 'attendee') }}</div>
      </div>
    </header>
    <p v-if="session.summary" class="mt-2 text-sm text-ink-700 line-clamp-3">
      {{ session.summary }}
    </p>
  </article>
</template>

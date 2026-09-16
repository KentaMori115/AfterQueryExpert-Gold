<script setup lang="ts">
import { computed, ref } from 'vue'

import {
  type CalendarDay,
  type CalendarShape,
  advanceDays,
  buildMonthGrid,
  groupEventsByDay,
  totalDaysPerYear,
} from '@core/lib/inworld-calendar'

import type { CalendarMarkedEvent } from '../types'

const props = defineProps<{
  shape: CalendarShape
  today?: CalendarDay | null
  events?: ReadonlyArray<CalendarMarkedEvent>
  yearSuffix?: string
}>()

const emit = defineEmits<{
  (e: 'select', value: CalendarDay): void
}>()

const initialDay = props.today ?? { year: 1, month: 1, day: 1 }
const cursor = ref<CalendarDay>({ ...initialDay })

const grid = computed(() => buildMonthGrid(cursor.value.year, cursor.value.month, props.shape, props.today ?? null))
const events = computed(() =>
  groupEventsByDay(
    (props.events ?? []).map((e) => ({ date: e.date, payload: e })),
    props.shape,
    cursor.value.year,
    cursor.value.month,
  ),
)

const monthLabel = computed(() => `Month ${cursor.value.month} of ${props.shape.monthsPerYear}`)
const yearLabel = computed(() => `${cursor.value.year}${props.yearSuffix ?? ''}`)
const daysInYear = computed(() => totalDaysPerYear(props.shape))

function shiftMonths(delta: number): void {
  const advance = delta * props.shape.daysPerMonth
  cursor.value = advanceDays(
    { year: cursor.value.year, month: cursor.value.month, day: 1 },
    advance,
    props.shape,
  )
}

function shiftYears(delta: number): void {
  cursor.value = { ...cursor.value, year: cursor.value.year + delta }
}

function jumpToToday(): void {
  if (props.today) cursor.value = { ...props.today }
}

function pick(day: number): void {
  emit('select', { year: cursor.value.year, month: cursor.value.month, day })
}

function toneClass(tone: CalendarMarkedEvent['tone']): string {
  switch (tone) {
    case 'success':
      return 'bg-moss-500'
    case 'warning':
      return 'bg-ember-500'
    case 'danger':
      return 'bg-crimson-500'
    case 'info':
      return 'bg-ink-700'
    default:
      return 'bg-parchment-500'
  }
}
</script>

<template>
  <div class="surface p-3 space-y-3">
    <header class="flex items-center justify-between">
      <div>
        <h3 class="text-sm uppercase tracking-wider text-ink-400">{{ yearLabel }}</h3>
        <p class="text-xs text-ink-500">{{ monthLabel }} ({{ daysInYear }} day year)</p>
      </div>
      <div class="flex flex-wrap gap-1 text-xs">
        <button type="button" class="px-2 py-1 rounded-soft hover:bg-parchment-100" @click="shiftYears(-1)">prev year</button>
        <button type="button" class="px-2 py-1 rounded-soft hover:bg-parchment-100" @click="shiftMonths(-1)">prev month</button>
        <button
          v-if="props.today"
          type="button"
          class="px-2 py-1 rounded-soft hover:bg-parchment-100"
          @click="jumpToToday"
        >
          today
        </button>
        <button type="button" class="px-2 py-1 rounded-soft hover:bg-parchment-100" @click="shiftMonths(1)">next month</button>
        <button type="button" class="px-2 py-1 rounded-soft hover:bg-parchment-100" @click="shiftYears(1)">next year</button>
      </div>
    </header>

    <div
      class="grid gap-1 text-xs"
      :style="{ gridTemplateColumns: `repeat(${Math.min(props.shape.daysPerMonth, 10)}, minmax(0, 1fr))` }"
    >
      <button
        v-for="cell in grid"
        :key="cell.index"
        type="button"
        class="aspect-square rounded-soft border border-parchment-200 hover:bg-parchment-100 text-ink-700 flex flex-col items-center justify-center"
        :class="cell.isToday ? 'border-ember-500 text-ember-700 bg-parchment-50' : ''"
        :aria-label="`Day ${cell.day}`"
        @click="pick(cell.day)"
      >
        <span class="font-mono">{{ cell.day }}</span>
        <span
          v-if="events[cell.day]"
          class="flex gap-0.5"
          aria-hidden="true"
        >
          <span
            v-for="(ev, i) in events[cell.day]!.slice(0, 3)"
            :key="i"
            class="w-1 h-1 rounded-full"
            :class="toneClass(ev.tone)"
          />
        </span>
      </button>
    </div>

    <ul v-if="Object.keys(events).length > 0" class="text-xs text-ink-600 space-y-0.5">
      <template v-for="day in Object.keys(events).map(Number).sort((a,b) => a-b)" :key="day">
        <li v-for="(ev, idx) in events[day]" :key="day + '-' + idx">
          <span class="font-mono text-ink-500">Day {{ day }}</span>
          &middot; {{ ev.label }}
        </li>
      </template>
    </ul>
  </div>
</template>

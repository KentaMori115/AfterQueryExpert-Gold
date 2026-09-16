<script setup lang="ts">
import { computed } from 'vue'

import { exhaustionLabel } from '@core/rules/conditions'
import type { JourneyReport } from '@core/rules/journey'
import { daysOfFood, startingSupply } from '@core/rules/supply'
import { formatDayShort } from '@core/lib/inworld-calendar'
import { severityTone } from '@core/rules/weather'

import EmptyState from '@ui/primitives/EmptyState.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'

const props = defineProps<{ report: JourneyReport; mouths: number }>()

const outcome = computed(() => {
  if (props.report.stalled) return { tone: 'danger' as const, text: 'stalled on the road' }
  if (props.report.arrived) return { tone: 'success' as const, text: 'arrived' }
  return { tone: 'warning' as const, text: 'still walking' }
})

const hungryCount = computed(() => props.report.days.filter((d) => d.hungry).length)

// What is left in the packs, read the way the trailhead reads it: whole days
// for the party that is actually walking, not a raw ration count.
const larderDays = computed(() =>
  daysOfFood(startingSupply(props.report.rationsLeft), props.mouths),
)

const worstDay = computed(() => {
  let worst: (typeof props.report.days)[number] | null = null
  for (const day of props.report.days) {
    if (!worst || day.covered < worst.covered) worst = day
  }
  return worst
})
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <StatusBadge :tone="outcome.tone" :soft="false">{{ outcome.text }}</StatusBadge>
      <span class="text-ink-500">{{ report.days.length }} days</span>
      <span class="text-ink-500">{{ report.rationsLeft }} rations left</span>
      <span v-if="report.milesLeft > 0" class="text-ink-500">
        {{ report.milesLeft }} miles short
      </span>
      <span v-if="hungryCount > 0" class="text-ink-500">{{ hungryCount }} hungry days</span>
      <span class="text-ink-500">{{ exhaustionLabel(report.exhaustion) }}</span>
      <span v-if="worstDay" class="text-ink-500">
        worst day {{ worstDay.covered }} mi under {{ worstDay.weather }}
      </span>
      <span class="text-ink-500">packs cover {{ larderDays }} more days</span>
    </div>

    <EmptyState v-if="report.days.length === 0" title="Nothing to walk">
      Add a leg and the party can set out.
    </EmptyState>

    <table v-else class="w-full text-sm">
      <thead class="text-xs uppercase text-ink-500">
        <tr>
          <th class="text-left py-1">Day</th>
          <th class="text-left py-1">Leg</th>
          <th class="text-left py-1">Sky</th>
          <th class="text-right py-1">Worth</th>
          <th class="text-right py-1">Walked</th>
          <th class="text-right py-1">Rations</th>
          <th class="text-left py-1">Wear</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(day, i) in report.days"
          :key="i"
          class="border-t border-parchment-200"
          :class="day.hungry ? 'bg-amber-50' : ''"
        >
          <td class="py-1">{{ formatDayShort(day.date) }}</td>
          <td class="py-1">{{ day.legName }}</td>
          <td class="py-1">
            <StatusBadge :tone="severityTone(day.severity)">{{ day.weather }}</StatusBadge>
          </td>
          <td class="py-1 text-right tabular-nums">{{ day.allowance }}</td>
          <td class="py-1 text-right tabular-nums">{{ day.covered }}</td>
          <td class="py-1 text-right tabular-nums">{{ day.rationsLeft }}</td>
          <td class="py-1">{{ day.exhaustion }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

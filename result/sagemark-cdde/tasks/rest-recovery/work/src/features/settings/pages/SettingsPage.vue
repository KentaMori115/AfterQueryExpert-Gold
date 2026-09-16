<script setup lang="ts">
import { computed } from 'vue'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

import { THEMES, useSettingsStore, type Theme } from '../store'

const settings = useSettingsStore()

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { label: 'Settings' },
])

function pickTheme(t: Theme): void {
  settings.setTheme(t)
}
</script>

<template>
  <section class="container-wide py-8 space-y-6 max-w-3xl">
    <BreadcrumbTrail :crumbs="crumbs" />
    <PageHeader title="Settings" subtitle="Tweak the feel, not the campaign." />

    <SurfaceCard title="Theme" hint="Picks how the page reads at the table">
      <div class="flex flex-wrap gap-2">
        <button
          v-for="t in THEMES"
          :key="t"
          type="button"
          class="px-3 py-1.5 rounded-soft text-sm"
          :class="settings.theme === t ? 'bg-ink-700 text-white' : 'bg-parchment-100 text-ink-700 hover:bg-parchment-200'"
          @click="pickTheme(t)"
        >
          {{ t }}
        </button>
      </div>
    </SurfaceCard>

    <SurfaceCard title="Dice" hint="Defaults for the inline roller">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="text-sm text-ink-700">
          Default die
          <select
            id="setting-default-die"
            :value="settings.dice.defaultDie"
            class="mt-1 w-full border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
            @change="settings.setDice({ defaultDie: Number(($event.target as HTMLSelectElement).value) })"
          >
            <option v-for="n in [4, 6, 8, 10, 12, 20, 100]" :key="n" :value="n">d{{ n }}</option>
          </select>
        </label>
        <label class="text-sm text-ink-700">
          Roll history depth
          <input
            id="setting-history"
            type="number"
            min="0"
            max="100"
            :value="settings.dice.history"
            class="mt-1 w-full border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
            @change="settings.setDice({ history: Number(($event.target as HTMLInputElement).value) })"
          />
        </label>
        <label class="sm:col-span-2 flex items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            :checked="settings.dice.showInline"
            @change="settings.setDice({ showInline: ($event.target as HTMLInputElement).checked })"
          />
          Show the inline roller in the shell
        </label>
      </div>
    </SurfaceCard>

    <SurfaceCard title="Calendar" hint="The in-world calendar shape for timeline events">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label class="text-sm text-ink-700">
          Months per year
          <input
            id="setting-months"
            type="number"
            min="1"
            max="36"
            :value="settings.calendar.monthsPerYear"
            class="mt-1 w-full border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
            @change="settings.setCalendar({ monthsPerYear: Number(($event.target as HTMLInputElement).value) })"
          />
        </label>
        <label class="text-sm text-ink-700">
          Days per month
          <input
            id="setting-days"
            type="number"
            min="1"
            max="60"
            :value="settings.calendar.daysPerMonth"
            class="mt-1 w-full border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
            @change="settings.setCalendar({ daysPerMonth: Number(($event.target as HTMLInputElement).value) })"
          />
        </label>
        <label class="text-sm text-ink-700">
          Year suffix (e.g. DR)
          <input
            id="setting-suffix"
            type="text"
            :value="settings.calendar.yearSuffix"
            class="mt-1 w-full border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
            @change="settings.setCalendar({ yearSuffix: ($event.target as HTMLInputElement).value })"
          />
        </label>
      </div>
    </SurfaceCard>

    <SurfaceCard>
      <BaseButton tone="danger" @click="settings.reset">Reset to defaults</BaseButton>
    </SurfaceCard>
  </section>
</template>

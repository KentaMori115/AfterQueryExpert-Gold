<script setup lang="ts">
import { computed } from 'vue';

import AppIcon from '@/ui/AppIcon.vue';
import type { IconName } from '@/ui/icons';

/**
 * The navigation rail.
 *
 * Grouped by what the crew are doing rather than by what the data is. Daily
 * work at the top, the weekly regulatory round in the middle, planning at the
 * bottom, because that is the order somebody standing on the barge at seven in
 * the morning wants them in.
 */

interface Entry {
  readonly to: string;
  readonly label: string;
  readonly icon: IconName;
  readonly countKey?: 'alerts';
}

interface Group {
  readonly label: string;
  readonly entries: readonly Entry[];
}

const props = withDefaults(
  defineProps<{
    readonly siteName: string;
    readonly generationCode: string;
    readonly alertCount?: number;
    readonly urgentAlerts?: boolean;
    readonly version: string;
  }>(),
  { alertCount: 0, urgentAlerts: false },
);

const GROUPS: readonly Group[] = [
  {
    label: 'Daily',
    entries: [
      { to: '/pens', label: 'Pens', icon: 'pen' },
      { to: '/feed', label: 'Feed plan', icon: 'pellet' },
      { to: '/water', label: 'Water', icon: 'thermometer' },
      { to: '/alerts', label: 'Alerts', icon: 'alert', countKey: 'alerts' },
    ],
  },
  {
    label: 'Weekly',
    entries: [{ to: '/lice', label: 'Lice register', icon: 'louse' }],
  },
  {
    label: 'Planning',
    entries: [
      { to: '/biomass', label: 'Biomass', icon: 'scales' },
      { to: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

const countFor = computed(() => (entry: Entry) => {
  if (entry.countKey !== 'alerts') return null;
  return props.alertCount > 0 ? props.alertCount : null;
});
</script>

<template>
  <nav class="rail" aria-label="Sections">
    <div class="brand">
      <span class="wordmark">Netpen</span>
      <span class="site" :title="siteName">{{ siteName }}</span>
      <span class="generation">{{ generationCode }}</span>
    </div>

    <div class="nav">
      <div v-for="group in GROUPS" :key="group.label">
        <div class="group">{{ group.label }}</div>
        <RouterLink
          v-for="entry in group.entries"
          :key="entry.to"
          :to="entry.to"
          class="link"
          active-class="active"
        >
          <AppIcon :name="entry.icon" />
          <span>{{ entry.label }}</span>
          <span v-if="countFor(entry) !== null" class="count" :class="{ alarm: urgentAlerts }">{{
            countFor(entry)
          }}</span>
        </RouterLink>
      </div>
    </div>

    <div class="foot">Netpen {{ version }}</div>
  </nav>
</template>

<style scoped>
.rail {
  grid-area: rail;
  display: flex;
  flex-direction: column;
  width: var(--rail-w);
  background: var(--surface-rail);
  color: var(--ink-inverse);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  overflow-y: auto;
}

.brand {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--gap-4) var(--gap-5);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.wordmark {
  font-size: var(--type-lg);
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #ffffff;
}

.site {
  font-size: var(--type-xs);
  color: rgba(255, 255, 255, 0.6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.generation {
  font-family: var(--font-num);
  font-size: var(--type-xs);
  color: rgba(255, 255, 255, 0.4);
}

.nav {
  display: flex;
  flex-direction: column;
  padding: var(--gap-3) var(--gap-2);
  gap: 1px;
}

.group {
  padding: var(--gap-4) var(--gap-3) var(--gap-1);
  font-size: var(--type-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.35);
}

.link {
  display: flex;
  align-items: center;
  gap: var(--gap-3);
  padding: var(--gap-2) var(--gap-3);
  border-radius: var(--radius-sm);
  color: rgba(255, 255, 255, 0.72);
  font-size: var(--type-sm);
  text-decoration: none;
}

.link:hover {
  background: rgba(255, 255, 255, 0.07);
  color: #ffffff;
  text-decoration: none;
}

.active {
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
  font-weight: 600;
}

.count {
  margin-left: auto;
  min-width: 20px;
  padding: 0 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  font-family: var(--font-num);
  font-size: var(--type-xs);
  text-align: center;
}

.alarm {
  background: var(--coral-500);
  color: #ffffff;
}

.foot {
  margin-top: auto;
  padding: var(--gap-4) var(--gap-5);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: var(--type-xs);
  color: rgba(255, 255, 255, 0.45);
}
</style>

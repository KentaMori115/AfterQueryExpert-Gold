<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useClock } from '@/app/clock';
import NavRail from '@/app/layout/NavRail.vue';
import TopBar from '@/app/layout/TopBar.vue';
import { useAlerts, useGeneration, usePenBoard, usePeople, useSite } from '@/app/queries';
import type { RouteMeta } from '@/app/router';
import { SHORTCUTS, useShortcuts } from '@/app/shortcuts';
import { APP_VERSION } from '@/app/version';
import { needsAttention } from '@/domain/alerts/types';
import ErrorBoundary from '@/ui/ErrorBoundary.vue';

/**
 * The shell around every route.
 *
 * It owns the three pieces of state that belong to the whole site rather than
 * to any one screen: who is signed in, how many things are waiting, and how
 * fresh the last lice count is. Screens get none of that, which is what keeps
 * them testable on their own.
 */

const route = useRoute();
const router = useRouter();
const { now } = useClock();

useShortcuts({ router });

/**
 * The shortcut list is on the page rather than only in a help document,
 * because a shortcut nobody knows about is a shortcut that does not exist. It
 * stays out of the way until it is focused, which is the same trick the skip
 * link uses.
 */
const shortcutsOpen = ref(false);

const site = useSite();
const generation = useGeneration();
const people = usePeople();
const alerts = useAlerts();
const board = usePenBoard();

const title = computed(() => (route.meta as Partial<RouteMeta>).title ?? 'Netpen');

const liveAlerts = computed(() => (alerts.data.value ?? []).filter(needsAttention));

const lastCountAt = computed(() => {
  let latest: number | null = null;
  for (const row of board.data.value ?? []) {
    const at = row.view.lice.latest?.countedAt ?? null;
    if (at !== null && (latest === null || at > latest)) latest = at;
  }
  return latest;
});

const person = computed(() => people.data.value?.[0] ?? null);
</script>

<template>
  <div class="shell">
    <!-- The rail is long and identical on every screen; somebody working the
         board by keyboard should not tab past it each time. -->
    <a href="#main" class="skip">Skip to content</a>

    <NavRail
      :site-name="site.data.value?.name ?? 'Loading site'"
      :generation-code="generation.data.value?.code ?? ''"
      :alert-count="liveAlerts.length"
      :urgent-alerts="liveAlerts.some((alert) => alert.severity === 'urgent')"
      :version="APP_VERSION"
    />

    <TopBar
      :title="title"
      :now="now"
      :stocked-at="generation.data.value?.firstStockedAt ?? null"
      :last-count-at="lastCountAt"
      :person-name="person?.name ?? null"
      :person-initials="person?.initials ?? null"
    />

    <main id="main" class="main">
      <ErrorBoundary>
        <RouterView />
      </ErrorBoundary>
    </main>

    <div class="keys">
      <button
        type="button"
        class="keysToggle"
        :aria-expanded="shortcutsOpen"
        @click="shortcutsOpen = !shortcutsOpen"
      >
        Keys
      </button>
      <ul v-if="shortcutsOpen" class="keyList">
        <li v-for="shortcut in SHORTCUTS" :key="shortcut.key">
          <kbd>{{ shortcut.key }}</kbd>
          <span>{{ shortcut.label }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-areas:
    'rail top'
    'rail main';
  grid-template-columns: var(--rail-w) 1fr;
  grid-template-rows: var(--topbar-h) 1fr;
  height: 100%;
}

.main {
  grid-area: main;
  overflow-y: auto;
  padding: var(--gap-5);
}

.keys {
  position: fixed;
  right: var(--gap-3);
  bottom: var(--gap-3);
  z-index: var(--z-sticky);
  display: flex;
  flex-direction: column-reverse;
  align-items: flex-end;
  gap: var(--gap-2);
}

.keysToggle {
  padding: var(--gap-1) var(--gap-3);
  border: 1px solid var(--rule-hair);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  color: var(--ink-muted);
  font: inherit;
  font-size: var(--type-xs);
  cursor: pointer;
  opacity: 0.7;
}

.keysToggle:hover,
.keysToggle:focus-visible {
  opacity: 1;
  color: var(--ink-primary);
}

.keyList {
  margin: 0;
  padding: var(--gap-3);
  border: 1px solid var(--rule-hair);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  box-shadow: var(--lift-2);
  list-style: none;
  font-size: var(--type-xs);
}

.keyList li {
  display: flex;
  align-items: center;
  gap: var(--gap-3);
  padding: 2px 0;
}

kbd {
  min-width: 1.4rem;
  padding: 1px var(--gap-1);
  border: 1px solid var(--rule-firm);
  border-radius: var(--radius-xs);
  background: var(--surface-sunken);
  font-family: var(--font-num);
  text-align: center;
}

/* No point offering keys on a device that has none. */
@media (pointer: coarse) {
  .keys {
    display: none;
  }
}

.skip {
  position: absolute;
  left: var(--gap-3);
  top: -60px;
  z-index: var(--z-toast);
  padding: var(--gap-2) var(--gap-4);
  background: var(--surface-card);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  font-size: var(--type-sm);
  transition: top 120ms ease;
}

.skip:focus {
  top: var(--gap-3);
  text-decoration: none;
}

/*
 * Below 900 px the rail drops to a strip along the bottom. Barge terminals are
 * landscape in a case; this is really for the phone in somebody's pocket at
 * the pen, checking whether a count has been filed.
 */
@media (max-width: 900px) {
  .shell {
    grid-template-areas:
      'top'
      'main'
      'rail';
    grid-template-columns: 1fr;
    grid-template-rows: var(--topbar-h) 1fr auto;
  }

  .main {
    padding: var(--gap-3);
  }
}
</style>

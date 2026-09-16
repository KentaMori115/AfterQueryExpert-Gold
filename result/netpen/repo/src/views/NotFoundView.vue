<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import AppIcon from '@/ui/AppIcon.vue';

/**
 * A wrong address.
 *
 * Written to be useful rather than decorative, because the way somebody
 * usually gets here is a bookmark to a pen that has since been renumbered, or
 * a link pasted into a message with a bracket stuck on the end. So it says
 * what was asked for, guesses at what was meant where the shape of the address
 * makes that possible, and offers the handful of places worth going.
 */
const route = useRoute();

const asked = computed(() => route.fullPath);

/** A pen address with something unusable in the identifier. */
const penGuess = computed(() => {
  const match = /^\/pens\/([^/]+)/.exec(route.path);
  if (match === null) return null;
  const digits = /\d+/.exec(match[1] ?? '');
  return digits === null ? null : `/pens/pen-${digits[0]}`;
});

const DESTINATIONS = [
  { to: '/pens', label: 'Pen board', note: 'Every pen on the site' },
  { to: '/lice', label: 'Lice register', note: 'The weekly count record' },
  { to: '/biomass', label: 'Biomass', note: 'Standing stock against the licence' },
  { to: '/alerts', label: 'Alerts', note: 'What is asking for somebody' },
] as const;
</script>

<template>
  <section class="lost">
    <p class="mark" aria-hidden="true"><AppIcon name="boat" /></p>

    <h2>That address does not match anything here</h2>

    <p class="asked">
      Nothing is served at <code>{{ asked }}</code
      >.
    </p>

    <p v-if="penGuess !== null" class="guess">
      If a pen was meant, <RouterLink :to="penGuess">{{ penGuess }}</RouterLink> is the address this
      site would use.
    </p>

    <ul class="destinations">
      <li v-for="destination in DESTINATIONS" :key="destination.to">
        <RouterLink :to="destination.to">
          <span class="label">{{ destination.label }}</span>
          <span class="note">{{ destination.note }}</span>
        </RouterLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.lost {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--gap-3);
  max-width: 46rem;
  padding: var(--gap-6);
  border: 1px solid var(--rule-hair);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.mark {
  margin: 0;
  color: var(--ink-muted);
}

h2 {
  margin: 0;
  font-size: var(--type-lg);
}

.asked,
.guess {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--type-sm);
}

code {
  padding: 1px var(--gap-1);
  border-radius: var(--radius-xs);
  background: var(--surface-sunken);
  font-family: var(--font-num);
}

.destinations {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--gap-2);
  width: 100%;
  margin: var(--gap-2) 0 0;
  padding: 0;
  list-style: none;
}

.destinations a {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--gap-3);
  border: 1px solid var(--rule-hair);
  border-radius: var(--radius-sm);
  color: inherit;
  text-decoration: none;
}

.destinations a:hover {
  border-color: var(--accent);
}

.label {
  font-size: var(--type-sm);
}

.note {
  color: var(--ink-muted);
  font-size: var(--type-xs);
}
</style>

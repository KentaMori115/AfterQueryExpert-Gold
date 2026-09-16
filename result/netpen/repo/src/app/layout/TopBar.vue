<script setup lang="ts">
import { computed } from 'vue';

import { formatCycleAge } from '@/domain/time/duration';
import AppIcon from '@/ui/AppIcon.vue';

/**
 * The top bar.
 *
 * Three things live here because they belong to the whole site rather than to
 * any one screen: how far through the cycle the fish are, how fresh the last
 * lice count is, and who is signed in. The count freshness is the one that
 * earns its place: the whole weekly regulatory rhythm hangs off it, and it is
 * exactly the thing that gets forgotten in a bad week.
 */

const props = withDefaults(
  defineProps<{
    readonly title: string;
    readonly now: number;
    readonly stockedAt: number | null;
    readonly lastCountAt: number | null;
    /** Days after which the count is overdue. */
    readonly countIntervalDays?: number;
    readonly personName: string | null;
    readonly personInitials: string | null;
  }>(),
  { countIntervalDays: 8, personName: null, personInitials: null },
);

const cycleAge = computed(() =>
  props.stockedAt === null ? '—' : formatCycleAge(props.stockedAt, props.now),
);

const daysSinceCount = computed(() =>
  props.lastCountAt === null ? null : (props.now - props.lastCountAt) / 86_400_000,
);

const countOverdue = computed(
  () => daysSinceCount.value === null || daysSinceCount.value > props.countIntervalDays,
);

const countLabel = computed(() => {
  if (daysSinceCount.value === null) return 'No count filed';
  const days = Math.round(daysSinceCount.value);
  if (days === 0) return 'Counted today';
  return `Counted ${days} ${days === 1 ? 'day' : 'days'} ago`;
});

const clock = computed(() =>
  new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  })
    .format(new Date(props.now))
    .replace(',', ''),
);
</script>

<template>
  <header class="bar">
    <div class="heading">
      <h1 class="title">{{ title }}</h1>
      <span class="cycle">{{ cycleAge }}</span>
    </div>

    <span class="spacer" />

    <div class="status">
      <span class="count" :class="{ overdue: countOverdue }">
        <AppIcon name="louse" :size="15" />
        {{ countLabel }}
      </span>

      <span class="clock" title="Site time, UTC">
        <AppIcon name="clock" :size="15" />
        {{ clock }}
      </span>

      <span v-if="personName !== null" class="who">
        <span class="avatar" aria-hidden="true">{{ personInitials }}</span>
        <span>{{ personName }}</span>
      </span>
    </div>
  </header>
</template>

<style scoped>
.bar {
  grid-area: top;
  display: flex;
  align-items: center;
  gap: var(--gap-4);
  height: var(--topbar-h);
  padding: 0 var(--gap-5);
  background: var(--surface-card);
  border-bottom: 1px solid var(--rule-hair);
}

.heading {
  display: flex;
  align-items: baseline;
  gap: var(--gap-3);
  min-width: 0;
}

.title {
  font-size: var(--type-md);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cycle {
  font-family: var(--font-num);
  font-size: var(--type-xs);
  color: var(--ink-muted);
  white-space: nowrap;
}

.spacer {
  flex: 1;
}

.status {
  display: flex;
  align-items: center;
  gap: var(--gap-4);
  font-size: var(--type-xs);
  color: var(--ink-secondary);
}

.count,
.clock,
.who {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-2);
  white-space: nowrap;
}

.clock {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
}

.overdue {
  color: var(--caution);
  font-weight: 600;
}

.avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--accent);
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--type-xs);
  font-weight: 700;
}

@media (max-width: 760px) {
  .count span,
  .who span:last-child {
    display: none;
  }
}
</style>

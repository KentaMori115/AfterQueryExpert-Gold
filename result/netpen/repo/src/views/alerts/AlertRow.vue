<script setup lang="ts">
import { computed } from 'vue';

import {
  ALERT_LABELS,
  isAcknowledged,
  isOpen,
  isRegulatory,
  type Alert,
} from '@/domain/alerts/types';
import AppIcon from '@/ui/AppIcon.vue';
import BaseBadge from '@/ui/BaseBadge.vue';
import { formatDateTime, formatNumber, formatRelative, MISSING } from '@/ui/format';
import { toneForSeverity } from '@/ui/tones';

/**
 * One alert.
 *
 * The acknowledgement is the interesting part. Acknowledging an alert means
 * somebody has seen it and taken it on, which is not the same as it being
 * fixed, so an acknowledged alert stays on the list with a name against it
 * rather than disappearing. Regulatory alerts say so, because acknowledging
 * one changes nothing about the obligation and somebody will otherwise assume
 * it does.
 */
const props = defineProps<{
  readonly alert: Alert;
  readonly now: number;
  readonly acknowledging?: boolean;
}>();

const emit = defineEmits<{ acknowledge: [alertId: string] }>();

const open = computed(() => isOpen(props.alert));
const acknowledged = computed(() => isAcknowledged(props.alert));
const regulatory = computed(() => isRegulatory(props.alert.kind));

const penId = computed(() =>
  props.alert.subject.type === 'site' ? null : String(props.alert.subject.penId),
);

const deadline = computed(() => {
  const actByAt = props.alert.actByAt;
  if (actByAt === null) return null;
  const days = (actByAt - props.now) / 86_400_000;
  return { at: actByAt, days, passed: days < 0 };
});

const against = computed(() => {
  const { observed, limit } = props.alert;
  if (observed === null) return null;
  if (limit === null) return formatNumber(observed, 2);
  return `${formatNumber(observed, 2)} against ${formatNumber(limit, 2)}`;
});
</script>

<template>
  <li class="row" :class="[alert.severity, { cleared: !open, acknowledged }]">
    <span class="mark" aria-hidden="true">
      <AppIcon :name="open ? 'alert' : 'check'" />
    </span>

    <div class="body">
      <p class="head">
        <BaseBadge :tone="toneForSeverity(alert.severity)" :solid="open && !acknowledged" dot>
          {{ ALERT_LABELS[alert.kind] }}
        </BaseBadge>
        <RouterLink v-if="penId !== null" class="pen" :to="`/pens/${penId}`">
          {{ penId.replace('pen-', 'Pen ') }}
        </RouterLink>
        <span
          v-if="regulatory"
          class="regulatory"
          title="Carries an obligation outside the company"
        >
          Regulatory
        </span>
      </p>

      <p class="message">{{ alert.message }}</p>

      <p class="meta">
        <span>Raised {{ formatRelative(alert.raisedAt, now) }}</span>
        <span v-if="against !== null">{{ against }}</span>
        <span v-if="deadline !== null" :class="{ passed: deadline.passed }">
          {{ deadline.passed ? 'Deadline passed' : 'Act by' }}
          {{ formatDateTime(deadline.at) }}
        </span>
        <span v-if="!open">Cleared {{ formatRelative(alert.clearedAt, now) }}</span>
      </p>
    </div>

    <div class="action">
      <span v-if="acknowledged" class="by">
        Taken by {{ alert.acknowledgedBy ?? MISSING }}
        <span class="when">{{ formatRelative(alert.acknowledgedAt, now) }}</span>
      </span>
      <button
        v-else-if="open"
        type="button"
        class="control-button control-small"
        :disabled="acknowledging"
        @click="emit('acknowledge', String(alert.id))"
      >
        {{ acknowledging ? 'Taking' : 'Take it on' }}
      </button>
    </div>
  </li>
</template>

<style scoped>
.row {
  display: flex;
  align-items: flex-start;
  gap: var(--gap-3);
  padding: var(--gap-3) var(--gap-4);
  border-bottom: 1px solid var(--rule-hair);
}

.row.urgent {
  border-left: 3px solid var(--fault);
}

.row.warning {
  border-left: 3px solid var(--caution);
}

.row.info {
  border-left: 3px solid var(--sea-400);
}

.cleared {
  opacity: 0.6;
}

.mark {
  display: flex;
  padding-top: 2px;
  color: var(--ink-muted);
}

.urgent .mark {
  color: var(--fault);
}

.body {
  flex: 1;
  min-width: 0;
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gap-2);
  margin: 0;
}

.pen {
  color: var(--accent);
  font-size: var(--type-sm);
  text-decoration: none;
}

.regulatory {
  padding: 1px var(--gap-2);
  border: 1px solid var(--fault);
  border-radius: var(--radius-xs);
  color: var(--fault);
  font-size: var(--type-xs);
}

.message {
  margin: var(--gap-1) 0 0;
  font-size: var(--type-sm);
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-3);
  margin: var(--gap-1) 0 0;
  color: var(--ink-muted);
  font-size: var(--type-xs);
}

.passed {
  color: var(--fault);
}

.action {
  flex-shrink: 0;
}

.by {
  color: var(--ink-muted);
  font-size: var(--type-xs);
  text-align: right;
}

.when {
  display: block;
}
</style>

<script setup lang="ts">
import { useId } from 'vue';

/**
 * A titled region.
 *
 * A panel that is itself the subject of an alarm gets an edge rather than a
 * fill: filling it makes the numbers inside harder to read at a glance, which
 * is the opposite of what an alarm is for.
 */
withDefaults(
  defineProps<{
    readonly title?: string;
    readonly subtitle?: string;
    readonly tone?: 'plain' | 'caution' | 'alarm';
    /** Removes body padding, for a panel whose body is a table. */
    readonly tight?: boolean;
  }>(),
  { title: undefined, subtitle: undefined, tone: 'plain', tight: false },
);

const headingId = useId();
</script>

<template>
  <section
    class="panel"
    :class="tone"
    :aria-labelledby="title === undefined ? undefined : headingId"
  >
    <header v-if="title !== undefined || $slots.actions" class="head">
      <div class="headings">
        <h2 v-if="title !== undefined" :id="headingId" class="title">{{ title }}</h2>
        <span v-if="subtitle !== undefined" class="subtitle">{{ subtitle }}</span>
      </div>
      <div v-if="$slots.actions" class="actions"><slot name="actions" /></div>
    </header>

    <div class="body" :class="{ tight }"><slot /></div>

    <footer v-if="$slots.footer" class="foot"><slot name="footer" /></footer>
  </section>
</template>

<style scoped>
.panel {
  background: var(--surface-card);
  border: 1px solid var(--rule-hair);
  border-radius: var(--radius-md);
  box-shadow: var(--lift-1);
  overflow: hidden;
}

.alarm {
  border-color: var(--fault);
  box-shadow: inset 3px 0 0 var(--fault);
}

.caution {
  border-color: var(--caution);
  box-shadow: inset 3px 0 0 var(--caution);
}

.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--gap-4);
  padding: var(--gap-4) var(--gap-5);
  border-bottom: 1px solid var(--rule-hair);
}

.headings {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.title {
  font-size: var(--type-md);
  font-weight: 600;
  margin: 0;
}

.subtitle {
  font-size: var(--type-sm);
  color: var(--ink-muted);
}

.actions {
  display: flex;
  align-items: center;
  gap: var(--gap-2);
  flex: none;
}

.body {
  padding: var(--gap-5);
}

.tight {
  padding: 0;
}

.foot {
  padding: var(--gap-3) var(--gap-5);
  border-top: 1px solid var(--rule-hair);
  background: var(--surface-sunken);
  font-size: var(--type-sm);
  color: var(--ink-secondary);
}
</style>

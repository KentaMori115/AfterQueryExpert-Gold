<script setup lang="ts">
import { onErrorCaptured, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { APP_VERSION } from '@/app/version';

import AppIcon from './AppIcon.vue';

/**
 * The last line of defence.
 *
 * A render error inside one screen should not take the shell with it: the rail
 * still works, and moving to another section is usually the fastest way for
 * somebody on a barge to carry on with their morning. So this catches, shows
 * what happened, and clears itself on the next navigation.
 *
 * It shows the message rather than hiding it behind "something went wrong".
 * The people using this are technical about fish rather than about software,
 * but they are the ones who will have to relay it down a satellite phone, and
 * a stack frame in that sentence is worth more than an apology.
 */
const props = withDefaults(
  defineProps<{
    /** Where to send it. Absent in the demonstration build, which says so. */
    readonly report?: ((error: unknown) => void) | null;
  }>(),
  { report: null },
);

const failure = ref<Error | null>(null);
const route = useRoute();

onErrorCaptured((error) => {
  failure.value = error instanceof Error ? error : new Error(String(error));
  props.report?.(error);
  // Swallowed here: letting it through unmounts the shell, which is the thing
  // this exists to prevent.
  return false;
});

// A new screen is a fresh start; keeping the failure would strand somebody who
// navigated away from the broken one.
watch(
  () => route.fullPath,
  () => {
    failure.value = null;
  },
);

function retry(): void {
  failure.value = null;
}
</script>

<template>
  <div v-if="failure !== null" class="broken" role="alert">
    <p class="mark" aria-hidden="true"><AppIcon name="alert" /></p>

    <h2>This screen stopped</h2>

    <p class="what">
      The rest of the application is still working. Moving to another section, or trying this one
      again, is usually enough.
    </p>

    <pre class="detail">{{ failure.message }}</pre>

    <p class="where">
      On {{ route.fullPath }}, build {{ APP_VERSION }}.
      <template v-if="report === null">
        Nothing is sent anywhere from this build, so this is worth writing down before it goes.
      </template>
    </p>

    <button type="button" @click="retry">Try this screen again</button>
  </div>

  <slot v-else />
</template>

<style scoped>
.broken {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--gap-3);
  max-width: 52rem;
  padding: var(--gap-5);
  border: 1px solid var(--fault);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.mark {
  margin: 0;
  color: var(--fault);
}

h2 {
  margin: 0;
  font-size: var(--type-lg);
}

.what,
.where {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--type-sm);
}

.detail {
  width: 100%;
  margin: 0;
  padding: var(--gap-3);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--ink-primary);
  font-family: var(--font-num);
  font-size: var(--type-xs);
  white-space: pre-wrap;
  overflow-x: auto;
}

button {
  padding: var(--gap-2) var(--gap-4);
  border: 1px solid var(--rule-firm);
  border-radius: var(--radius-xs);
  background: var(--surface-card);
  color: inherit;
  font: inherit;
  font-size: var(--type-sm);
  cursor: pointer;
}

button:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>

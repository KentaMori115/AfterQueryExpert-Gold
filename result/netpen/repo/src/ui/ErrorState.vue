<script setup lang="ts">
import { computed } from 'vue';

import { describeError, isApiError } from '@/data/http';

/**
 * Something went wrong. The offline case gets its own wording, because on a
 * site the link drops several times a day and "the server had a problem" is
 * both wrong and alarming when the truth is "you are out of radio contact".
 */
const props = withDefaults(defineProps<{ readonly error: unknown; readonly title?: string }>(), {
  title: undefined,
});

const emit = defineEmits<{ retry: [] }>();

const offline = computed(() => isApiError(props.error) && props.error.kind === 'offline');
const heading = computed(
  () => props.title ?? (offline.value ? 'No link to shore' : 'Could not load this'),
);
const detail = computed(() => describeError(props.error));
</script>

<template>
  <div class="box" :class="{ offline }" role="alert">
    <span class="title">{{ heading }}</span>
    <span class="detail">{{ detail }}</span>
    <span class="actions"
      ><slot name="action"
        ><button type="button" class="retry" @click="emit('retry')">Try again</button></slot
      ></span
    >
  </div>
</template>

<style scoped>
.box {
  display: flex;
  flex-direction: column;
  gap: var(--gap-2);
  padding: var(--gap-4) var(--gap-5);
  border: 1px solid var(--fault);
  border-radius: var(--radius-sm);
  background: var(--fault-wash);
}

.offline {
  border-color: var(--caution);
  background: var(--caution-wash);
}

.title {
  font-weight: 600;
}

.detail {
  font-size: var(--type-sm);
  color: var(--ink-secondary);
}

.retry {
  padding: var(--gap-1) var(--gap-3);
  border: 1px solid var(--rule-firm);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  font-size: var(--type-sm);
}
</style>

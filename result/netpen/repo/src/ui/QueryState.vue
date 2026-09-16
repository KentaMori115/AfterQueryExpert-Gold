<script setup lang="ts" generic="T">
/**
 * The loading, error, empty, loaded ladder, written once.
 *
 * Every screen goes through this, which is why none of them get the order
 * wrong. The order itself is the whole point: loading wins over everything,
 * an error wins over empty, and empty is only reached when the request came
 * back and genuinely had nothing in it.
 */
import EmptyState from './EmptyState.vue';
import ErrorState from './ErrorState.vue';
import LoadingBars from './LoadingBars.vue';

const props = withDefaults(
  defineProps<{
    readonly loading: boolean;
    readonly error: unknown;
    readonly data: T | undefined;
    readonly isEmpty?: (data: T) => boolean;
    readonly emptyTitle?: string;
    readonly emptyBody?: string;
    readonly skeletonLines?: number;
  }>(),
  {
    isEmpty: undefined,
    emptyTitle: 'Nothing to show',
    emptyBody: undefined,
    skeletonLines: 3,
  },
);

const emit = defineEmits<{ retry: [] }>();

function empty(data: T | undefined): boolean {
  return data !== undefined && props.isEmpty !== undefined && props.isEmpty(data);
}
</script>

<template>
  <LoadingBars v-if="loading" :lines="skeletonLines" />
  <ErrorState v-else-if="error" :error="error" @retry="emit('retry')" />
  <ErrorState
    v-else-if="data === undefined"
    :error="new Error('No data came back')"
    @retry="emit('retry')"
  />
  <EmptyState v-else-if="empty(data)" :title="emptyTitle" :body="emptyBody" />
  <slot v-else :data="data" />
</template>

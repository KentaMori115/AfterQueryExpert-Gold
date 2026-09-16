<script setup lang="ts">
import { computed } from 'vue';

import { ICONS, type IconName } from './icons';

const props = withDefaults(
  defineProps<{
    readonly name: IconName;
    readonly size?: number;
    /** Give it a label only where it is the sole thing carrying the meaning. */
    readonly label?: string;
  }>(),
  { size: 18, label: undefined },
);

const shape = computed(() => ICONS[props.name]);
const decorative = computed(() => props.label === undefined);
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    :role="decorative ? undefined : 'img'"
    :aria-hidden="decorative ? 'true' : undefined"
    :aria-label="label"
    focusable="false"
  >
    <path v-for="(d, index) in shape.paths" :key="index" :d="d" />
    <circle
      v-for="(dot, index) in shape.dots ?? []"
      :key="`dot-${index}`"
      :cx="dot[0]"
      :cy="dot[1]"
      :r="dot[2]"
      fill="currentColor"
      stroke="none"
    />
  </svg>
</template>

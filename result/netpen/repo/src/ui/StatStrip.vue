<script setup lang="ts">
/**
 * The row of headline figures at the top of a screen.
 *
 * It was the same grid copied into five views, and copies drift: two of them
 * had already picked up different minimum widths, so the board wrapped to two
 * rows at a width where the register did not. On a wall mounted screen that
 * reads as one of them being broken.
 *
 * The minimum width is a prop rather than a constant because the alerts strip
 * carries four short counts and the biomass strip carries five long ones, and
 * forcing those to the same track width wastes half the row on one of them.
 */
withDefaults(
  defineProps<{
    /** Narrowest a tile may get before the row wraps. */
    readonly minWidth?: string;
  }>(),
  { minWidth: '180px' },
);
</script>

<template>
  <div class="strip" :style="{ '--strip-min': minWidth }">
    <slot />
  </div>
</template>

<style scoped>
.strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--strip-min), 1fr));
  gap: var(--gap-3);
}
</style>

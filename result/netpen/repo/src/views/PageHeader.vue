<script setup lang="ts">
import { computed } from 'vue';

/**
 * The heading every screen opens with.
 *
 * Seven screens had their own copy of a heading, a paragraph of standfirst and
 * a row of controls floated to the right, and the copies had drifted in the
 * usual way: three different maximum line lengths, and two that dropped the
 * controls under the heading at a different width from the rest.
 *
 * The line length is the part worth keeping honest. The standfirst on these
 * screens is doing real work, explaining a regulatory rule or what a
 * projection assumes, and it only gets read if it is set at a width somebody
 * can read down.
 */
const props = defineProps<{
  readonly title: string;
  readonly note?: string;
}>();

/**
 * Collapsed, because these are written across several lines in the template
 * that supplies them and the line breaks come through into the text node. A
 * browser hides that; a screen reader reading it aloud does not, and neither
 * does anything that copies the text back out.
 */
const note = computed(() => props.note?.replace(/\s+/g, ' ').trim());
</script>

<template>
  <header class="head">
    <div class="titles">
      <h2>{{ title }}</h2>
      <p v-if="note !== undefined" class="note">{{ note }}</p>
      <slot name="note" />
    </div>
    <div v-if="$slots.actions" class="actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gap-4);
}

h2 {
  margin: 0;
  font-size: var(--type-xl);
}

.note {
  margin: var(--gap-1) 0 0;
  max-width: 74ch;
  color: var(--ink-muted);
  font-size: var(--type-sm);
}

.actions {
  display: flex;
  align-items: center;
  gap: var(--gap-4);
}
</style>

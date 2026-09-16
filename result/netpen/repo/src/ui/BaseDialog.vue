<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';

import AppIcon from './AppIcon.vue';

/**
 * A modal.
 *
 * Written against the native dialog element rather than a div with a high z
 * index, because the native one gets the top layer, the backdrop and the
 * escape key from the browser, and those are the three things hand rolled
 * modals get wrong.
 *
 * Two behaviours are deliberate and worth stating. Clicking the backdrop does
 * not close it: everything this application opens in a modal is a form the
 * crew are part way through, and losing a half entered lice count to a stray
 * click on the wet screen of a barge is unforgivable. And escape is allowed to
 * close it, but goes through the same guard, so a form that wants to confirm
 * can.
 */
const props = withDefaults(
  defineProps<{
    readonly open: boolean;
    readonly title: string;
    readonly subtitle?: string;
    /** Return false to keep it open, for a form with unsaved work. */
    readonly beforeClose?: () => boolean;
    readonly width?: string;
  }>(),
  { subtitle: undefined, beforeClose: undefined, width: '32rem' },
);

const emit = defineEmits<{ close: [] }>();

const dialog = ref<HTMLDialogElement | null>(null);
const headingId = useId();

/**
 * showModal throws where the element is already open or not connected, which
 * happens on a hot reload and would take the page down with it. It is also
 * simply absent in some test environments, so both paths fall back to the open
 * attribute rather than assuming the method is there.
 */
function show(element: HTMLDialogElement): void {
  try {
    element.showModal();
  } catch {
    element.setAttribute('open', '');
  }
  if (!element.open) element.setAttribute('open', '');
}

function hide(element: HTMLDialogElement): void {
  try {
    element.close();
  } catch {
    element.removeAttribute('open');
  }
  if (element.open) element.removeAttribute('open');
}

function requestClose(): void {
  if (props.beforeClose !== undefined && !props.beforeClose()) return;
  emit('close');
}

function onCancel(event: Event): void {
  // The browser fires this on escape and would close the element itself.
  // Taking it over keeps every route out of the dialog going through the guard.
  event.preventDefault();
  requestClose();
}

watch(
  () => props.open,
  async (open) => {
    await nextTick();
    const element = dialog.value;
    if (element === null) return;

    if (open && !element.open) show(element);
    else if (!open && element.open) hide(element);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  const element = dialog.value;
  if (element?.open) hide(element);
});
</script>

<template>
  <dialog
    ref="dialog"
    class="sheet"
    :style="{ width }"
    :aria-labelledby="headingId"
    @cancel="onCancel"
  >
    <header>
      <div class="titles">
        <h2 :id="headingId">{{ title }}</h2>
        <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>
      </div>
      <button type="button" class="close" aria-label="Close" @click="requestClose">
        <AppIcon name="cross" />
      </button>
    </header>

    <div class="body">
      <slot />
    </div>

    <footer v-if="$slots.actions">
      <slot name="actions" :close="requestClose" />
    </footer>
  </dialog>
</template>

<style scoped>
.sheet {
  max-width: calc(100vw - 2rem);
  max-height: calc(100vh - 4rem);
  padding: 0;
  border: 1px solid var(--rule-firm);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  color: var(--ink-primary);
  box-shadow: var(--lift-3);
}

.sheet::backdrop {
  background: var(--surface-scrim);
}

header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gap-3);
  padding: var(--gap-4);
  border-bottom: 1px solid var(--rule-hair);
}

h2 {
  margin: 0;
  font-size: var(--type-lg);
}

.subtitle {
  margin: var(--gap-1) 0 0;
  color: var(--ink-muted);
  font-size: var(--type-sm);
}

.close {
  display: flex;
  padding: var(--gap-1);
  border: 0;
  border-radius: var(--radius-xs);
  background: none;
  color: var(--ink-muted);
  cursor: pointer;
}

.close:hover {
  background: var(--surface-sunken);
  color: var(--ink-primary);
}

.body {
  padding: var(--gap-4);
  overflow-y: auto;
}

footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--gap-2);
  padding: var(--gap-3) var(--gap-4);
  border-top: 1px solid var(--rule-hair);
  background: var(--surface-sunken);
}
</style>

/**
 * Keyboard navigation.
 *
 * The people who use this all day are standing at a bench with a keyboard and
 * one hand free, so the sections are on single keys rather than on modifier
 * combinations. Single keys are only safe if they are properly suppressed
 * while something is being typed into, which is most of what this module is:
 * a lice count being entered has a number in every box, and a stray "5" that
 * navigated away instead of landing in the box would be unforgivable.
 *
 * The other rule is that a modifier means the browser wanted it. Ctrl+P is
 * printing, Cmd+L is the address bar, and taking either of those over is
 * exactly the sort of cleverness that makes an application feel hostile.
 */

import { onBeforeUnmount, onMounted } from 'vue';
import type { Router } from 'vue-router';

export interface Shortcut {
  readonly key: string;
  readonly to: string;
  readonly label: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { key: 'p', to: '/pens', label: 'Pen board' },
  { key: 'l', to: '/lice', label: 'Lice register' },
  { key: 'f', to: '/feed', label: 'Feed plan' },
  { key: 'b', to: '/biomass', label: 'Biomass' },
  { key: 'w', to: '/water', label: 'Water' },
  { key: 'a', to: '/alerts', label: 'Alerts' },
  { key: ',', to: '/settings', label: 'Settings' },
];

const TYPING_ELEMENTS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Whether the keystroke belongs to something the user is filling in. */
export function isTyping(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof HTMLElement)) return false;
  if (TYPING_ELEMENTS.has(target.tagName)) return true;
  return target.isContentEditable === true;
}

export function shortcutFor(event: KeyboardEvent): Shortcut | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (isTyping(event.target)) return null;

  const key = event.key.toLowerCase();
  return SHORTCUTS.find((shortcut) => shortcut.key === key) ?? null;
}

export interface ShortcutOptions {
  readonly router: Router;
  readonly target?: EventTarget;
}

/**
 * Binds the shortcuts for as long as the component is mounted. Returns the
 * handler so a test can drive it without a component, which is worth more than
 * it costs: the interesting cases here are all about what it declines to do.
 */
export function useShortcuts(options: ShortcutOptions): (event: KeyboardEvent) => void {
  const handler = (event: KeyboardEvent): void => {
    const shortcut = shortcutFor(event);
    if (shortcut === null) return;

    // A dialog is modal; navigating out from under one leaves a form open over
    // a screen it was never about.
    if (options.router.currentRoute.value.path === shortcut.to) return;
    if (globalThis.document?.querySelector('dialog[open]') !== null) return;

    event.preventDefault();
    void options.router.push(shortcut.to);
  };

  onMounted(() => {
    (options.target ?? globalThis.window).addEventListener('keydown', handler as EventListener);
  });

  onBeforeUnmount(() => {
    (options.target ?? globalThis.window).removeEventListener('keydown', handler as EventListener);
  });

  return handler;
}

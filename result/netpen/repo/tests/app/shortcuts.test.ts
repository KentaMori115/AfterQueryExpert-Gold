import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

import { createAppRouter } from '@/app/router';
import { isTyping, SHORTCUTS, shortcutFor, useShortcuts } from '@/app/shortcuts';

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, cancelable: true, ...init });
}

/** A keystroke aimed at a particular element, which the guard reads. */
function pressInto(key: string, tagName: string): KeyboardEvent {
  const element = document.createElement(tagName);
  document.body.append(element);
  const event = press(key);
  Object.defineProperty(event, 'target', { value: element });
  return event;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the table', () => {
  it('puts every section on a key of its own', () => {
    const keys = SHORTCUTS.map((shortcut) => shortcut.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('uses single keys rather than combinations, since one hand is free', () => {
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.key.length).toBe(1);
    }
  });
});

describe('what counts as typing', () => {
  it('treats a text box as typing', () => {
    expect(isTyping(document.createElement('input'))).toBe(true);
    expect(isTyping(document.createElement('textarea'))).toBe(true);
    expect(isTyping(document.createElement('select'))).toBe(true);
  });

  it('treats an editable region as typing', () => {
    const element = document.createElement('div');
    Object.defineProperty(element, 'isContentEditable', { value: true });
    expect(isTyping(element)).toBe(true);
  });

  it('does not treat the page itself as typing', () => {
    expect(isTyping(document.createElement('div'))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});

describe('matching a keystroke', () => {
  it('finds the section a key belongs to', () => {
    expect(shortcutFor(press('l'))?.to).toBe('/lice');
  });

  it('takes an upper case key, since caps lock is on half the barges', () => {
    expect(shortcutFor(press('L'))?.to).toBe('/lice');
  });

  it('leaves anything with a modifier to the browser', () => {
    expect(shortcutFor(press('p', { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(press('l', { metaKey: true }))).toBeNull();
    expect(shortcutFor(press('a', { altKey: true }))).toBeNull();
  });

  it('stays out of the way while a count is being entered', () => {
    expect(shortcutFor(pressInto('5', 'input'))).toBeNull();
    expect(shortcutFor(pressInto('f', 'input'))).toBeNull();
  });

  it('ignores a key that is not on the list', () => {
    expect(shortcutFor(press('q'))).toBeNull();
  });
});

describe('binding them', () => {
  /**
   * The router is taken to its starting route before the listener is bound.
   * Binding first and navigating afterwards leaves the first keystroke racing
   * the initial navigation, which is not what any of these are about.
   */
  async function host(startAt: string) {
    const router = createAppRouter();
    await router.push(startAt);
    await router.isReady();

    const component = defineComponent({
      setup() {
        useShortcuts({ router, target: window });
        return () => null;
      },
    });
    return { router, wrapper: mount(component) };
  }

  it('navigates on a bound key', async () => {
    const { router } = await host('/pens');
    // The handler does not await the navigation, and the screen it goes to is
    // fetched on demand, so the test has to wait on the push itself rather
    // than on a tick.
    const push = vi.spyOn(router, 'push');

    window.dispatchEvent(press('a'));
    await push.mock.results[0]?.value;

    expect(router.currentRoute.value.path).toBe('/alerts');
  });

  it('does nothing when already on that section', async () => {
    const { router } = await host('/alerts');
    const push = vi.spyOn(router, 'push');

    window.dispatchEvent(press('a'));
    expect(push).not.toHaveBeenCalled();
  });

  it('leaves a modal alone rather than navigating out from under it', async () => {
    const { router } = await host('/pens');

    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);

    const push = vi.spyOn(router, 'push');
    window.dispatchEvent(press('a'));
    expect(push).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe('/pens');
  });

  it('stops listening once the shell is gone', async () => {
    const { router, wrapper } = await host('/pens');
    wrapper.unmount();

    window.dispatchEvent(press('a'));
    expect(router.currentRoute.value.path).toBe('/pens');
  });
});

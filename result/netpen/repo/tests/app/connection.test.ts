import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';

import { connectionNotice, stalenessMinutes, useConnection } from '@/app/connection';

const MINUTE = 60_000;
const NOW = Date.UTC(2025, 2, 18, 9, 0);

/** The composable binds listeners on mount, so it is exercised under one. */
function connection(navigatorOnline: () => boolean) {
  let state: ReturnType<typeof useConnection> | null = null;
  const target = new EventTarget();

  const wrapper = mount(
    defineComponent({
      setup() {
        state = useConnection({ navigatorOnline, target });
        return () => null;
      },
    }),
  );

  return { state: state!, target, wrapper };
}

describe('where it starts', () => {
  it('believes the browser when it says the link is down', () => {
    expect(connection(() => false).state.status.value).toBe('offline');
  });

  it('starts online where the browser says so', () => {
    expect(connection(() => true).state.status.value).toBe('online');
  });

  it('has reached nothing yet, which is not the same as reaching it long ago', () => {
    expect(connection(() => true).state.lastReachedAt.value).toBeNull();
  });
});

describe('what changes it', () => {
  it('follows the browser going offline', async () => {
    let online = true;
    const { state, target, wrapper } = connection(() => online);

    online = false;
    target.dispatchEvent(new Event('offline'));
    await wrapper.vm.$nextTick();

    expect(state.status.value).toBe('offline');
  });

  it('is put back online by a request that actually landed', () => {
    const { state } = connection(() => false);
    state.reportReached(NOW);

    expect(state.status.value).toBe('online');
    expect(state.lastReachedAt.value).toBe(NOW);
  });

  it('goes offline on a request that could not be sent', () => {
    const { state } = connection(() => true);
    state.reportUnreachable();
    expect(state.status.value).toBe('offline');
  });

  it('keeps the time of the last success through a later failure', () => {
    const { state } = connection(() => true);
    state.reportReached(NOW);
    state.reportUnreachable();
    expect(state.lastReachedAt.value).toBe(NOW);
  });

  it('stops listening once the shell is gone', async () => {
    let online = true;
    const { state, target, wrapper } = connection(() => online);
    wrapper.unmount();

    online = false;
    target.dispatchEvent(new Event('offline'));
    expect(state.status.value).toBe('online');
  });
});

describe('how stale the figures are', () => {
  it('is nothing at all until something has been reached', () => {
    expect(stalenessMinutes(null, NOW)).toBeNull();
  });

  it('is nothing within the first minute, rather than a zero', () => {
    expect(stalenessMinutes(NOW - 20_000, NOW)).toBeNull();
  });

  it('counts whole minutes, rounded down', () => {
    expect(stalenessMinutes(NOW - 4.9 * MINUTE, NOW)).toBe(4);
  });
});

describe('what it says about it', () => {
  it('says nothing while everything is current', () => {
    expect(connectionNotice('online', NOW - 30_000, NOW)).toBeNull();
  });

  it('stays quiet through a short gap, which is just the tick', () => {
    expect(connectionNotice('online', NOW - 5 * MINUTE, NOW)).toBeNull();
  });

  it('mentions a long gap even while it thinks it is online', () => {
    expect(connectionNotice('online', NOW - 22 * MINUTE, NOW)).toBe('Last reached 22 minutes ago.');
  });

  it('says how old the figures are when the link is down', () => {
    expect(connectionNotice('offline', NOW - 7 * MINUTE, NOW)).toBe(
      'Offline. These figures are 7 minutes old.',
    );
  });

  it('gets the singular right, since it is read at a glance', () => {
    expect(connectionNotice('offline', NOW - MINUTE, NOW)).toContain('1 minute old');
  });

  it('says nothing has come in rather than claiming figures are current', () => {
    expect(connectionNotice('offline', null, NOW)).toBe('Offline. Nothing has come in yet.');
  });
});

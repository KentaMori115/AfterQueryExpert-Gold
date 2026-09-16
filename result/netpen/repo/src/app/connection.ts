/**
 * Whether the terminal can reach anything.
 *
 * A site office is on a leased line and the barge is on a link that goes down
 * when the weather turns, so a screen that silently shows figures from before
 * the squall is worse than one that says it is offline. The whole point is to
 * be able to tell "nothing has changed" from "nothing has arrived".
 *
 * Two signals, and neither is trusted on its own. The browser's own online
 * flag is quick but it only knows whether a network is attached, which on a
 * barge is nearly always true and nearly always meaningless. So a request that
 * came back offline counts too, and it is the one that clears the flag: the
 * link is back when something actually crossed it.
 */

import { onBeforeUnmount, onMounted, readonly, ref, type Ref } from 'vue';

export type Connection = 'online' | 'offline';

export interface ConnectionState {
  readonly status: Readonly<Ref<Connection>>;
  /** When the last request came back with something, or null if none has. */
  readonly lastReachedAt: Readonly<Ref<number | null>>;
  /** Called by the query layer after every request finishes. */
  reportReached(at: number): void;
  reportUnreachable(): void;
}

export interface ConnectionOptions {
  readonly navigatorOnline?: () => boolean;
  readonly target?: EventTarget;
}

export function useConnection(options: ConnectionOptions = {}): ConnectionState {
  const readNavigator = options.navigatorOnline ?? (() => globalThis.navigator?.onLine ?? true);

  const status = ref<Connection>(readNavigator() ? 'online' : 'offline');
  const lastReachedAt = ref<number | null>(null);

  function fromBrowser(): void {
    // The browser saying it is offline is believed at once; the browser saying
    // it is online only lifts a flag nothing has contradicted, because an
    // attached network is not a reachable server.
    status.value = readNavigator() ? 'online' : 'offline';
  }

  onMounted(() => {
    const target = options.target ?? globalThis.window;
    target.addEventListener('online', fromBrowser);
    target.addEventListener('offline', fromBrowser);
  });

  onBeforeUnmount(() => {
    const target = options.target ?? globalThis.window;
    target.removeEventListener('online', fromBrowser);
    target.removeEventListener('offline', fromBrowser);
  });

  return {
    status: readonly(status),
    lastReachedAt: readonly(lastReachedAt),
    reportReached(at: number) {
      lastReachedAt.value = at;
      status.value = 'online';
    },
    reportUnreachable() {
      status.value = 'offline';
    },
  };
}

/** How stale the figures are, in whole minutes, or null while nothing is. */
export function stalenessMinutes(lastReachedAt: number | null, now: number): number | null {
  if (lastReachedAt === null) return null;
  const minutes = Math.floor((now - lastReachedAt) / 60_000);
  return minutes > 0 ? minutes : null;
}

/**
 * What to say about it. Silence while everything is current: a badge that is
 * always on the screen is a badge nobody reads on the day it matters.
 */
export function connectionNotice(
  status: Connection,
  lastReachedAt: number | null,
  now: number,
): string | null {
  if (status === 'offline') {
    const minutes = stalenessMinutes(lastReachedAt, now);
    if (minutes === null) return 'Offline. Nothing has come in yet.';
    return `Offline. These figures are ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} old.`;
  }

  const minutes = stalenessMinutes(lastReachedAt, now);
  return minutes !== null && minutes >= 10 ? `Last reached ${minutes} minutes ago.` : null;
}

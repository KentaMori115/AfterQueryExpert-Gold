import {
  computed,
  inject,
  onScopeDispose,
  provide,
  readonly,
  ref,
  type InjectionKey,
  type Ref,
} from 'vue';

import type { Instant } from '@/domain/time/duration';

/**
 * The clock.
 *
 * Nothing in the interface calls Date.now directly. Everything asks the clock,
 * which means a test or a screenshot can pin it, and it means the whole page
 * agrees on what "now" is: a cycle age and the lice deadline beside it are
 * computed from the same instant rather than from two calls a moment apart.
 *
 * The tick is deliberately coarse. Fish grow over months and a lice count is
 * taken once a week; a readout that updates every second is animation rather
 * than information, and it re-renders every row on the board for nothing.
 */

export const DEFAULT_TICK_MS = 60_000;

export interface Clock {
  readonly now: Readonly<Ref<Instant>>;
  /** Coarse bucket used in query keys so refetches line up with the tick. */
  readonly bucket: Readonly<Ref<number>>;
}

export const clockKey: InjectionKey<Clock> = Symbol('netpen.clock');

export interface ClockOptions {
  /** Pin the clock. When set it never advances. */
  readonly fixedNow?: Instant;
  readonly tickMs?: number;
}

export function provideClock(options: ClockOptions = {}): Clock {
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS;
  const now = ref<Instant>(options.fixedNow ?? Date.now());

  if (options.fixedNow === undefined) {
    const handle = setInterval(() => {
      now.value = Date.now();
    }, tickMs);

    onScopeDispose(() => {
      clearInterval(handle);
    });
  }

  const clock: Clock = {
    now: readonly(now),
    bucket: computed(() => Math.floor(now.value / tickMs)),
  };

  provide(clockKey, clock);
  return clock;
}

export function useClock(): Clock {
  const clock = inject(clockKey, null);
  if (clock === null) {
    throw new Error('useClock needs a clock provided further up the tree');
  }
  return clock;
}

/** Current instant, stable between ticks. */
export function useNow(): Readonly<Ref<Instant>> {
  return useClock().now;
}

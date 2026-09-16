/**
 * Mounting a screen.
 *
 * A view needs four things around it before it will render: a router for the
 * links, a pinia for the preferences, a query client, and a clock. Wiring them
 * per test file drifts, and a screen test that silently ran against a real
 * Date.now is a screen test that fails once a month at midnight.
 *
 * The clock here is pinned by default. Anything that wants to watch a page
 * move passes its own instant instead.
 */

import { VueQueryPlugin } from '@tanstack/vue-query';
import { mount, type MountingOptions, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { computed, defineComponent, h, ref, type Component } from 'vue';
import { createRouter, createWebHistory, type Router } from 'vue-router';

import { apiKey } from '@/app/api';
import { clockKey } from '@/app/clock';
import { createQueryClient } from '@/app/queries';
import { routes } from '@/app/router';
import type { NetpenApi } from '@/data/api';

import { TEST_NOW } from './penView';

export interface HarnessOptions {
  readonly api?: Partial<NetpenApi>;
  readonly now?: number;
  readonly path?: string;
  readonly props?: Record<string, unknown>;
  readonly slots?: MountingOptions<unknown>['slots'];
}

/** Anything a screen calls that the test did not stub is a failure, not a null. */
function apiProxy(overrides: Partial<NetpenApi>): NetpenApi {
  return new Proxy(overrides as NetpenApi, {
    get(target, property: string) {
      if (property in target) return target[property as keyof NetpenApi];
      return () => Promise.reject(new Error(`api.${property} was called but not stubbed`));
    },
  });
}

export function testRouter(path = '/'): Router {
  const router = createRouter({ history: createWebHistory(), routes });
  void router.push(path);
  return router;
}

export interface Harness {
  readonly wrapper: VueWrapper;
  readonly router: Router;
}

export async function mountView(
  component: Component,
  options: HarnessOptions = {},
): Promise<Harness> {
  const now = options.now ?? TEST_NOW;
  const router = testRouter(options.path ?? '/');
  await router.isReady();

  const wrapper = mount(component, {
    props: options.props,
    slots: options.slots,
    global: {
      plugins: [createPinia(), router, [VueQueryPlugin, { queryClient: createQueryClient() }]],
      provide: {
        [apiKey as symbol]: apiProxy(options.api ?? {}),
        // Real refs rather than plain objects holding a value: toValue only
        // unwraps the real thing, and a query keyed off a fake one gets the
        // object rather than the instant.
        [clockKey as symbol]: {
          now: ref(now),
          bucket: computed(() => Math.floor(now / 60_000)),
        },
      },
    },
  });

  return { wrapper, router };
}

/**
 * Lets a query settle. One tick is not enough: vue-query resolves the promise
 * on one turn and flushes the render on the next, so a single await gives a
 * loading skeleton and a confusing failure.
 */
export async function settle(wrapper: VueWrapper, turns = 4): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
    await wrapper.vm.$nextTick();
  }
}

/** A host that renders one component, for testing something that needs a parent. */
export function hostFor(component: Component, props: Record<string, unknown>): Component {
  return defineComponent({
    name: 'TestHost',
    render: () => h(component, props),
  });
}

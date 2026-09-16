import { inject, provide, type InjectionKey } from 'vue';

import type { NetpenApi } from '@/data/api';

/**
 * The API the tree talks to.
 *
 * Injected rather than imported, so a test can mount a screen against a stub
 * and so the demonstration backend and the HTTP backend are interchangeable
 * without a build flag threaded through every module.
 */

export const apiKey: InjectionKey<NetpenApi> = Symbol('netpen.api');

export function provideApi(api: NetpenApi): NetpenApi {
  provide(apiKey, api);
  return api;
}

export function useApi(): NetpenApi {
  const api = inject(apiKey, null);
  if (api === null) {
    throw new Error('useApi needs an api provided further up the tree');
  }
  return api;
}

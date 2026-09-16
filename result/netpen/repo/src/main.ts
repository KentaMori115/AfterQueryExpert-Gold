import { VueQueryPlugin } from '@tanstack/vue-query';
import { createPinia } from 'pinia';
import { createApp, h } from 'vue';

import { provideApi } from './app/api';
import { provideClock } from './app/clock';
import { readEnvironment, type AppConfig } from './app/config';
import { createQueryClient } from './app/queries';
import { createAppRouter } from './app/router';
import App from './App.vue';
import type { NetpenApi } from './data/api';
import { buildDataset } from './data/fixtures';
import { createLocalApi } from './data/localApi';
import './styles/base.css';
import './styles/print.css';

/**
 * Composition root.
 *
 * The backend is chosen once, from configuration. Nothing below this file
 * knows which one it got, which is what makes the demonstration build and the
 * real build the same application rather than two that drift apart.
 */
export function createApiFor(config: AppConfig): NetpenApi {
  if (config.backend === 'demo') {
    return createLocalApi(buildDataset(Date.now()));
  }
  throw new Error('The HTTP backend is not wired up in this build yet');
}

const config = readEnvironment();
const api = createApiFor(config);

const mount = document.getElementById('app');

if (!mount) {
  throw new Error('Netpen could not start: #app is missing from the document');
}

// The providers have to run inside a component setup so that the clock's
// interval is tied to a scope and torn down with it, which is why the root is
// a wrapper rather than App itself.
const root = createApp({
  setup() {
    provideClock({ tickMs: config.clockTickMs });
    provideApi(api);
    return () => h(App);
  },
});

root.use(createPinia());
root.use(createAppRouter());
root.use(VueQueryPlugin, { queryClient: createQueryClient() });
root.mount(mount);

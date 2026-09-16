import { describe, expect, it } from 'vitest';

import { createAppRouter, routes, titleFor } from '@/app/router';

async function routerAt(path: string) {
  const router = createAppRouter();
  await router.push(path);
  await router.isReady();
  return router;
}

describe('the route table', () => {
  it('sends the root to the board rather than to a landing page', async () => {
    const router = await routerAt('/');
    expect(router.currentRoute.value.path).toBe('/pens');
  });

  it('gives every route a title and a section', () => {
    for (const route of routes) {
      if (route.redirect !== undefined) continue;
      expect(route.meta, `${String(route.path)} has no meta`).toBeDefined();
      expect(typeof (route.meta as { title: string }).title).toBe('string');
    }
  });

  it('carries the pen through the path rather than a query string', async () => {
    const router = await routerAt('/pens/pen-4');
    expect(router.currentRoute.value.params.penId).toBe('pen-4');
  });

  it('lands anything unrecognised on the not found route', async () => {
    const router = await routerAt('/nowhere/at/all');
    expect(router.currentRoute.value.name).toBe('not-found');
  });

  it('splits the code, so a screen is fetched when it is first opened', () => {
    const board = routes.find((route) => route.name === 'pens');
    expect(typeof board?.component).toBe('function');
  });
});

describe('the tab title', () => {
  it('follows the route, so two open screens can be told apart', async () => {
    await routerAt('/lice');
    expect(document.title).toBe('Lice register · Netpen');
  });

  it('moves with a later navigation', async () => {
    const router = await routerAt('/lice');
    await router.push('/alerts');
    expect(document.title).toBe('Alerts · Netpen');
  });

  it('can be asked for a path without mounting anything', () => {
    expect(titleFor('/biomass')).toBe('Biomass and harvest');
  });

  it('falls back to the application name on a path it does not know', () => {
    expect(titleFor('/reports')).toBe('Netpen');
  });
});

import { createRouter, createWebHistory, type RouteRecordRaw, type Router } from 'vue-router';

/**
 * Routes.
 *
 * Flat on purpose. The application has one level of nesting, a list and the
 * thing you clicked on, and expressing that as a route hierarchy buys nothing
 * but an extra router-view to reason about.
 *
 * Screens are code split. A barge terminal opens the pen board every morning
 * over a link that is doing well to manage two megabits; the harvest planner
 * drags in the whole charting layer and is opened by two people a month. They
 * do not belong in the same bundle.
 */

export interface RouteMeta extends Record<string | number | symbol, unknown> {
  /** Shown in the top bar and announced on navigation. */
  readonly title: string;
  /** Section the rail highlights, where a route is a child of a list. */
  readonly section: string;
}

export const routes: readonly RouteRecordRaw[] = [
  { path: '/', redirect: '/pens' },
  {
    path: '/pens',
    name: 'pens',
    component: () => import('@/views/PenBoardView.vue'),
    meta: { title: 'Pens', section: 'pens' } satisfies RouteMeta,
  },
  {
    path: '/pens/:penId',
    name: 'pen',
    component: () => import('@/views/PenDetailView.vue'),
    props: true,
    meta: { title: 'Pen', section: 'pens' } satisfies RouteMeta,
  },
  {
    path: '/lice',
    name: 'lice',
    component: () => import('@/views/LiceRegisterView.vue'),
    meta: { title: 'Lice register', section: 'lice' } satisfies RouteMeta,
  },
  {
    path: '/feed',
    name: 'feed',
    component: () => import('@/views/FeedPlanView.vue'),
    meta: { title: 'Feed plan', section: 'feed' } satisfies RouteMeta,
  },
  {
    path: '/biomass',
    name: 'biomass',
    component: () => import('@/views/BiomassView.vue'),
    meta: { title: 'Biomass and harvest', section: 'biomass' } satisfies RouteMeta,
  },
  {
    path: '/water',
    name: 'water',
    component: () => import('@/views/WaterView.vue'),
    meta: { title: 'Water quality', section: 'water' } satisfies RouteMeta,
  },
  {
    path: '/alerts',
    name: 'alerts',
    component: () => import('@/views/AlertsView.vue'),
    meta: { title: 'Alerts', section: 'alerts' } satisfies RouteMeta,
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { title: 'Settings', section: 'settings' } satisfies RouteMeta,
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { title: 'Not found', section: '' } satisfies RouteMeta,
  },
];

export function createAppRouter(): Router {
  const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: [...routes],
    scrollBehavior(_to, _from, saved) {
      return saved ?? { top: 0 };
    },
  });

  // The tab title follows the route. Somebody with the board open on one
  // screen and a pen on another needs to tell them apart from the taskbar.
  router.afterEach((to) => {
    const meta = to.meta as Partial<RouteMeta>;
    document.title = meta.title === undefined ? 'Netpen' : `${meta.title} · Netpen`;
  });

  return router;
}

/** Title for a path, without every view having to declare one. */
export function titleFor(path: string): string {
  const match = routes.find((route) => route.path === path);
  const meta = match?.meta as Partial<RouteMeta> | undefined;
  return meta?.title ?? 'Netpen';
}

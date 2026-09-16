/**
 * Wires the sign-in and staff routes, each with the schema it validates against.
 */
import { Router } from 'express';
import type { Database } from '../../db/client';
import { requireAuth, requireScope } from '../../middleware/requireAuth';
import { validateRequest } from '../../middleware/validateRequest';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import {
  createStaffBody,
  listStaffQuery,
  noQuery,
  signInBody,
  staffIdParams,
  updateStaffBody,
} from './auth.schema';
import { AuthService } from './auth.service';

export interface AuthModule {
  router: Router;
  service: AuthService;
}

export function buildAuthModule(db: Database): AuthModule {
  const service = new AuthService(new AuthRepository(db));
  const controller = new AuthController(service);
  const router = Router();
  const authed = requireAuth(service);

  router.post(
    '/auth/sessions',
    validateRequest({ body: signInBody, query: noQuery }),
    controller.signIn,
  );

  router.delete(
    '/auth/sessions/current',
    authed,
    validateRequest({ query: noQuery }),
    controller.signOut,
  );

  router.get('/auth/me', authed, validateRequest({ query: noQuery }), controller.me);

  router.post(
    '/staff',
    authed,
    requireScope('staff'),
    validateRequest({ body: createStaffBody, query: noQuery }),
    controller.create,
  );

  router.get('/staff', authed, validateRequest({ query: listStaffQuery }), controller.list);

  router.get(
    '/staff/:staffId',
    authed,
    validateRequest({ params: staffIdParams, query: noQuery }),
    controller.read,
  );

  router.patch(
    '/staff/:staffId',
    authed,
    requireScope('staff'),
    validateRequest({ params: staffIdParams, body: updateStaffBody, query: noQuery }),
    controller.update,
  );

  return { router, service };
}

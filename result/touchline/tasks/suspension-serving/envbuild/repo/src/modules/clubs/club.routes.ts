/** Wires the club routes, each with the schema it validates against. */
import { Router } from 'express';
import type { Database } from '../../db/client';
import { requireAuth, requireScope } from '../../middleware/requireAuth';
import { validateRequest } from '../../middleware/validateRequest';
import type { AuthService } from '../auth/auth.service';
import type { VenueService } from '../venues/venue.service';
import { ClubController } from './club.controller';
import { ClubRepository } from './club.repository';
import {
  admitClubBody,
  clubIdParams,
  createClubBody,
  listClubsQuery,
  noQuery,
  reinstateClubBody,
  resignClubBody,
  suspendClubBody,
  updateClubBody,
} from './club.schema';
import { ClubService } from './club.service';

export interface ClubModule {
  router: Router;
  service: ClubService;
}

export function buildClubModule(db: Database, auth: AuthService, venues: VenueService): ClubModule {
  const service = new ClubService(new ClubRepository(db), venues);
  const controller = new ClubController(service);
  const router = Router();
  const authed = requireAuth(auth);
  const mayRegister = requireScope('registrations');

  router.post(
    '/clubs',
    authed,
    mayRegister,
    validateRequest({ body: createClubBody, query: noQuery }),
    controller.create,
  );

  router.get('/clubs', authed, validateRequest({ query: listClubsQuery }), controller.list);

  router.get(
    '/clubs/:clubId',
    authed,
    validateRequest({ params: clubIdParams, query: noQuery }),
    controller.read,
  );

  router.patch(
    '/clubs/:clubId',
    authed,
    mayRegister,
    validateRequest({ params: clubIdParams, body: updateClubBody, query: noQuery }),
    controller.update,
  );

  router.post(
    '/clubs/:clubId/admit',
    authed,
    mayRegister,
    validateRequest({ params: clubIdParams, body: admitClubBody, query: noQuery }),
    controller.admit,
  );

  router.post(
    '/clubs/:clubId/suspend',
    authed,
    mayRegister,
    validateRequest({ params: clubIdParams, body: suspendClubBody, query: noQuery }),
    controller.suspend,
  );

  router.post(
    '/clubs/:clubId/reinstate',
    authed,
    mayRegister,
    validateRequest({ params: clubIdParams, body: reinstateClubBody, query: noQuery }),
    controller.reinstate,
  );

  router.post(
    '/clubs/:clubId/resign',
    authed,
    mayRegister,
    validateRequest({ params: clubIdParams, body: resignClubBody, query: noQuery }),
    controller.resign,
  );

  return { router, service };
}

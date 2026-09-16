/** Wires the venue routes, each with the schema it validates against. */
import { Router } from 'express';
import type { Database } from '../../db/client';
import { requireAuth, requireScope } from '../../middleware/requireAuth';
import { validateRequest } from '../../middleware/validateRequest';
import type { AuthService } from '../auth/auth.service';
import { VenueController } from './venue.controller';
import { VenueRepository } from './venue.repository';
import {
  closeVenueBody,
  createVenueBody,
  listVenuesQuery,
  noQuery,
  updateVenueBody,
  venueIdParams,
} from './venue.schema';
import { VenueService } from './venue.service';

export interface VenueModule {
  router: Router;
  service: VenueService;
}

export function buildVenueModule(db: Database, auth: AuthService): VenueModule {
  const service = new VenueService(new VenueRepository(db));
  const controller = new VenueController(service);
  const router = Router();
  const authed = requireAuth(auth);
  const mayRun = requireScope('fixtures');

  router.post(
    '/venues',
    authed,
    mayRun,
    validateRequest({ body: createVenueBody, query: noQuery }),
    controller.create,
  );

  router.get('/venues', authed, validateRequest({ query: listVenuesQuery }), controller.list);

  router.get(
    '/venues/:venueId',
    authed,
    validateRequest({ params: venueIdParams, query: noQuery }),
    controller.read,
  );

  router.patch(
    '/venues/:venueId',
    authed,
    mayRun,
    validateRequest({ params: venueIdParams, body: updateVenueBody, query: noQuery }),
    controller.update,
  );

  router.post(
    '/venues/:venueId/close',
    authed,
    mayRun,
    validateRequest({ params: venueIdParams, body: closeVenueBody, query: noQuery }),
    controller.close,
  );

  router.post(
    '/venues/:venueId/reopen',
    authed,
    mayRun,
    validateRequest({ params: venueIdParams, query: noQuery }),
    controller.reopen,
  );

  return { router, service };
}

/** Wires the season routes, each with the schema it validates against. */
import { Router } from 'express';
import type { Database } from '../../db/client';
import { requireAuth, requireScope } from '../../middleware/requireAuth';
import { validateRequest } from '../../middleware/validateRequest';
import type { AuthService } from '../auth/auth.service';
import { SeasonController } from './season.controller';
import { SeasonRepository } from './season.repository';
import {
  closeSeasonBody,
  createSeasonBody,
  listSeasonsQuery,
  noQuery,
  openSeasonBody,
  seasonIdParams,
  updateSeasonBody,
} from './season.schema';
import { SeasonService } from './season.service';

export interface SeasonModule {
  router: Router;
  service: SeasonService;
}

export function buildSeasonModule(db: Database, auth: AuthService): SeasonModule {
  const service = new SeasonService(new SeasonRepository(db));
  const controller = new SeasonController(service);
  const router = Router();
  const authed = requireAuth(auth);
  const mayRun = requireScope('fixtures');

  router.post(
    '/seasons',
    authed,
    mayRun,
    validateRequest({ body: createSeasonBody, query: noQuery }),
    controller.create,
  );

  router.get('/seasons', authed, validateRequest({ query: listSeasonsQuery }), controller.list);

  router.get(
    '/seasons/:seasonId',
    authed,
    validateRequest({ params: seasonIdParams, query: noQuery }),
    controller.read,
  );

  router.patch(
    '/seasons/:seasonId',
    authed,
    mayRun,
    validateRequest({ params: seasonIdParams, body: updateSeasonBody, query: noQuery }),
    controller.update,
  );

  router.post(
    '/seasons/:seasonId/open',
    authed,
    mayRun,
    validateRequest({ params: seasonIdParams, body: openSeasonBody, query: noQuery }),
    controller.open,
  );

  router.post(
    '/seasons/:seasonId/close',
    authed,
    mayRun,
    validateRequest({ params: seasonIdParams, body: closeSeasonBody, query: noQuery }),
    controller.close,
  );

  return { router, service };
}

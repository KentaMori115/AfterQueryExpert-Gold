/** Wires the division routes, each with the schema it validates against. */
import { Router } from 'express';
import type { Database } from '../../db/client';
import { requireAuth, requireScope } from '../../middleware/requireAuth';
import { validateRequest } from '../../middleware/validateRequest';
import type { AuthService } from '../auth/auth.service';
import type { SeasonService } from '../seasons/season.service';
import { DivisionController } from './division.controller';
import { DivisionRepository } from './division.repository';
import {
  completeDivisionBody,
  createDivisionBody,
  divisionIdParams,
  fixDivisionBody,
  listDivisionsQuery,
  noQuery,
  seasonIdParams,
  updateDivisionBody,
} from './division.schema';
import { DivisionService } from './division.service';

export interface DivisionModule {
  router: Router;
  service: DivisionService;
}

export function buildDivisionModule(
  db: Database,
  auth: AuthService,
  seasons: SeasonService,
): DivisionModule {
  const service = new DivisionService(new DivisionRepository(db), seasons);
  const controller = new DivisionController(service);
  const router = Router();
  const authed = requireAuth(auth);
  const mayRun = requireScope('fixtures');

  router.post(
    '/seasons/:seasonId/divisions',
    authed,
    mayRun,
    validateRequest({ params: seasonIdParams, body: createDivisionBody, query: noQuery }),
    controller.create,
  );

  router.get(
    '/seasons/:seasonId/divisions',
    authed,
    validateRequest({ params: seasonIdParams, query: listDivisionsQuery }),
    controller.listForSeason,
  );

  router.get('/divisions', authed, validateRequest({ query: listDivisionsQuery }), controller.list);

  router.get(
    '/divisions/:divisionId',
    authed,
    validateRequest({ params: divisionIdParams, query: noQuery }),
    controller.read,
  );

  router.patch(
    '/divisions/:divisionId',
    authed,
    mayRun,
    validateRequest({ params: divisionIdParams, body: updateDivisionBody, query: noQuery }),
    controller.update,
  );

  router.post(
    '/divisions/:divisionId/fix',
    authed,
    mayRun,
    validateRequest({ params: divisionIdParams, body: fixDivisionBody, query: noQuery }),
    controller.fix,
  );

  router.post(
    '/divisions/:divisionId/complete',
    authed,
    mayRun,
    validateRequest({ params: divisionIdParams, body: completeDivisionBody, query: noQuery }),
    controller.complete,
  );

  return { router, service };
}

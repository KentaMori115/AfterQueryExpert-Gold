/** Wires the result routes, each with the schema it validates against. */
import { Router } from 'express';
import type { Database } from '../../db/client';
import { requireAuth, requireScope } from '../../middleware/requireAuth';
import { validateRequest } from '../../middleware/validateRequest';
import type { AuthService } from '../auth/auth.service';
import type { FixtureService } from '../fixtures/fixture.service';
import { ResultController } from './result.controller';
import { ResultRepository } from './result.repository';
import {
  confirmResultBody,
  disputeResultBody,
  fixtureIdParams,
  listResultsQuery,
  noQuery,
  reportResultBody,
  resultIdParams,
  settleResultBody,
} from './result.schema';
import { ResultService } from './result.service';

export interface ResultModule {
  router: Router;
  service: ResultService;
}

export function buildResultModule(
  db: Database,
  auth: AuthService,
  fixtures: FixtureService,
): ResultModule {
  const service = new ResultService(new ResultRepository(db), fixtures);
  const controller = new ResultController(service);
  const router = Router();
  const authed = requireAuth(auth);
  const mayScore = requireScope('results');

  router.post(
    '/fixtures/:fixtureId/result',
    authed,
    mayScore,
    validateRequest({ params: fixtureIdParams, body: reportResultBody, query: noQuery }),
    controller.report,
  );

  router.get(
    '/fixtures/:fixtureId/result',
    authed,
    validateRequest({ params: fixtureIdParams, query: noQuery }),
    controller.readForFixture,
  );

  router.get('/results', authed, validateRequest({ query: listResultsQuery }), controller.list);

  router.get(
    '/results/:resultId',
    authed,
    validateRequest({ params: resultIdParams, query: noQuery }),
    controller.read,
  );

  router.post(
    '/results/:resultId/confirm',
    authed,
    mayScore,
    validateRequest({ params: resultIdParams, body: confirmResultBody, query: noQuery }),
    controller.confirm,
  );

  router.post(
    '/results/:resultId/dispute',
    authed,
    mayScore,
    validateRequest({ params: resultIdParams, body: disputeResultBody, query: noQuery }),
    controller.dispute,
  );

  router.post(
    '/results/:resultId/settle',
    authed,
    mayScore,
    validateRequest({ params: resultIdParams, body: settleResultBody, query: noQuery }),
    controller.settle,
  );

  return { router, service };
}

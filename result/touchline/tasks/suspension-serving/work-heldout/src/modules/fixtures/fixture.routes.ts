/** Wires the fixture routes, each with the schema it validates against. */
import { Router } from 'express';
import type { Database } from '../../db/client';
import { requireAuth, requireScope } from '../../middleware/requireAuth';
import { validateRequest } from '../../middleware/validateRequest';
import type { AuthService } from '../auth/auth.service';
import type { DivisionService } from '../divisions/division.service';
import type { SeasonService } from '../seasons/season.service';
import type { TeamService } from '../teams/team.service';
import type { VenueService } from '../venues/venue.service';
import { FixtureController } from './fixture.controller';
import { FixtureRepository } from './fixture.repository';
import {
  abandonFixtureBody,
  awardFixtureBody,
  divisionIdParams,
  fixtureIdParams,
  listFixturesQuery,
  noQuery,
  postponeFixtureBody,
  rescheduleFixtureBody,
  scheduleFixtureBody,
} from './fixture.schema';
import { FixtureService } from './fixture.service';

export interface FixtureModule {
  router: Router;
  service: FixtureService;
}

export function buildFixtureModule(
  db: Database,
  auth: AuthService,
  divisions: DivisionService,
  teams: TeamService,
  venues: VenueService,
  seasons: SeasonService,
): FixtureModule {
  const service = new FixtureService(new FixtureRepository(db), divisions, teams, venues, seasons);
  const controller = new FixtureController(service);
  const router = Router();
  const authed = requireAuth(auth);
  const mayRun = requireScope('fixtures');

  router.post(
    '/divisions/:divisionId/fixtures',
    authed,
    mayRun,
    validateRequest({ params: divisionIdParams, body: scheduleFixtureBody, query: noQuery }),
    controller.schedule,
  );

  router.get(
    '/divisions/:divisionId/fixtures',
    authed,
    validateRequest({ params: divisionIdParams, query: listFixturesQuery }),
    controller.listForDivision,
  );

  router.get('/fixtures', authed, validateRequest({ query: listFixturesQuery }), controller.list);

  router.get(
    '/fixtures/:fixtureId',
    authed,
    validateRequest({ params: fixtureIdParams, query: noQuery }),
    controller.read,
  );

  router.post(
    '/fixtures/:fixtureId/postpone',
    authed,
    mayRun,
    validateRequest({ params: fixtureIdParams, body: postponeFixtureBody, query: noQuery }),
    controller.postpone,
  );

  router.post(
    '/fixtures/:fixtureId/abandon',
    authed,
    mayRun,
    validateRequest({ params: fixtureIdParams, body: abandonFixtureBody, query: noQuery }),
    controller.abandon,
  );

  router.post(
    '/fixtures/:fixtureId/reschedule',
    authed,
    mayRun,
    validateRequest({ params: fixtureIdParams, body: rescheduleFixtureBody, query: noQuery }),
    controller.reschedule,
  );

  router.post(
    '/fixtures/:fixtureId/award',
    authed,
    mayRun,
    validateRequest({ params: fixtureIdParams, body: awardFixtureBody, query: noQuery }),
    controller.award,
  );

  return { router, service };
}

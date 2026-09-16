/** Wires the table route. */
import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { validateRequest } from '../../middleware/validateRequest';
import type { AuthService } from '../auth/auth.service';
import type { ClubService } from '../clubs/club.service';
import type { DivisionService } from '../divisions/division.service';
import type { FixtureService } from '../fixtures/fixture.service';
import type { ResultService } from '../results/result.service';
import type { SeasonService } from '../seasons/season.service';
import type { TeamService } from '../teams/team.service';
import { StandingController } from './standing.controller';
import { divisionIdParams, tableQuery } from './standing.schema';
import { StandingService } from './standing.service';

export interface StandingModule {
  router: Router;
  service: StandingService;
}

export function buildStandingModule(
  auth: AuthService,
  divisions: DivisionService,
  teams: TeamService,
  clubs: ClubService,
  fixtures: FixtureService,
  results: ResultService,
  seasons: SeasonService,
): StandingModule {
  const service = new StandingService(divisions, teams, clubs, fixtures, results, seasons);
  const controller = new StandingController(service);
  const router = Router();

  router.get(
    '/divisions/:divisionId/table',
    requireAuth(auth),
    validateRequest({ params: divisionIdParams, query: tableQuery }),
    controller.table,
  );

  return { router, service };
}

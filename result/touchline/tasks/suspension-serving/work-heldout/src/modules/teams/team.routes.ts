/** Wires the team routes, each with the schema it validates against. */
import { Router } from 'express';
import type { Database } from '../../db/client';
import { requireAuth, requireScope } from '../../middleware/requireAuth';
import { validateRequest } from '../../middleware/validateRequest';
import type { AuthService } from '../auth/auth.service';
import type { ClubService } from '../clubs/club.service';
import type { DivisionService } from '../divisions/division.service';
import { TeamController } from './team.controller';
import { TeamRepository } from './team.repository';
import {
  divisionIdParams,
  enterTeamBody,
  listTeamsQuery,
  moveTeamBody,
  noQuery,
  teamIdParams,
  withdrawTeamBody,
} from './team.schema';
import { TeamService } from './team.service';

export interface TeamModule {
  router: Router;
  service: TeamService;
}

export function buildTeamModule(
  db: Database,
  auth: AuthService,
  divisions: DivisionService,
  clubs: ClubService,
): TeamModule {
  const service = new TeamService(new TeamRepository(db), divisions, clubs);
  const controller = new TeamController(service);
  const router = Router();
  const authed = requireAuth(auth);
  const mayRegister = requireScope('registrations');

  router.post(
    '/divisions/:divisionId/teams',
    authed,
    mayRegister,
    validateRequest({ params: divisionIdParams, body: enterTeamBody, query: noQuery }),
    controller.enter,
  );

  router.get(
    '/divisions/:divisionId/teams',
    authed,
    validateRequest({ params: divisionIdParams, query: listTeamsQuery }),
    controller.listForDivision,
  );

  router.get('/teams', authed, validateRequest({ query: listTeamsQuery }), controller.list);

  router.get(
    '/teams/:teamId',
    authed,
    validateRequest({ params: teamIdParams, query: noQuery }),
    controller.read,
  );

  router.post(
    '/teams/:teamId/withdraw',
    authed,
    mayRegister,
    validateRequest({ params: teamIdParams, body: withdrawTeamBody, query: noQuery }),
    controller.withdraw,
  );

  router.post(
    '/teams/:teamId/move',
    authed,
    mayRegister,
    validateRequest({ params: teamIdParams, body: moveTeamBody, query: noQuery }),
    controller.move,
  );

  return { router, service };
}

/** Wires the discipline routes, each with the schema it validates against. */
import { Router } from 'express';
import type { Database } from '../../db/client';
import { requireAuth, requireScope } from '../../middleware/requireAuth';
import { validateRequest } from '../../middleware/validateRequest';
import type { AuthService } from '../auth/auth.service';
import type { FixtureService } from '../fixtures/fixture.service';
import type { PlayerService } from '../players/player.service';
import type { TeamService } from '../teams/team.service';
import { DisciplineController } from './discipline.controller';
import { DisciplineRepository } from './discipline.repository';
import {
  cardIdParams,
  fixtureIdParams,
  listCardsQuery,
  noQuery,
  playerIdParams,
  recordQuery,
  rescindCardBody,
  showCardBody,
} from './discipline.schema';
import { DisciplineService } from './discipline.service';

export interface DisciplineModule {
  router: Router;
  service: DisciplineService;
}

export function buildDisciplineModule(
  db: Database,
  auth: AuthService,
  fixtures: FixtureService,
  players: PlayerService,
  teams: TeamService,
): DisciplineModule {
  const service = new DisciplineService(new DisciplineRepository(db), fixtures, players, teams);
  const controller = new DisciplineController(service);
  const router = Router();
  const authed = requireAuth(auth);
  const mayRule = requireScope('discipline');

  router.post(
    '/fixtures/:fixtureId/cards',
    authed,
    mayRule,
    validateRequest({ params: fixtureIdParams, body: showCardBody, query: noQuery }),
    controller.show,
  );

  router.get(
    '/fixtures/:fixtureId/cards',
    authed,
    validateRequest({ params: fixtureIdParams, query: listCardsQuery }),
    controller.listForFixture,
  );

  router.get('/cards', authed, validateRequest({ query: listCardsQuery }), controller.list);

  router.get(
    '/cards/:cardId',
    authed,
    validateRequest({ params: cardIdParams, query: noQuery }),
    controller.read,
  );

  router.post(
    '/cards/:cardId/rescind',
    authed,
    mayRule,
    validateRequest({ params: cardIdParams, body: rescindCardBody, query: noQuery }),
    controller.rescind,
  );

  router.get(
    '/players/:playerId/record',
    authed,
    validateRequest({ params: playerIdParams, query: recordQuery }),
    controller.record,
  );

  return { router, service };
}

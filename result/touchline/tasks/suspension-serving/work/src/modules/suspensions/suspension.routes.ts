/** Wires the two suspension readings. Both are reads, so any signed-in role may ask. */
import { Router } from 'express';
import type { Database } from '../../db/client';
import { requireAuth } from '../../middleware/requireAuth';
import { validateRequest } from '../../middleware/validateRequest';
import type { AuthService } from '../auth/auth.service';
import { DisciplineRepository } from '../discipline/discipline.repository';
import type { FixtureService } from '../fixtures/fixture.service';
import type { PlayerService } from '../players/player.service';
import type { TeamService } from '../teams/team.service';
import { SuspensionController } from './suspension.controller';
import { fixtureIdParams, ledgerQuery, noQuery, playerIdParams } from './suspension.schema';
import { SuspensionService } from './suspension.service';

export interface SuspensionModule {
  router: Router;
  service: SuspensionService;
}

export function buildSuspensionModule(
  db: Database,
  auth: AuthService,
  fixtures: FixtureService,
  players: PlayerService,
  teams: TeamService,
): SuspensionModule {
  const service = new SuspensionService(new DisciplineRepository(db), fixtures, players, teams);
  const controller = new SuspensionController(service);
  const router = Router();
  const authed = requireAuth(auth);

  router.get(
    '/players/:playerId/suspensions',
    authed,
    validateRequest({ params: playerIdParams, query: ledgerQuery }),
    controller.ledger,
  );

  router.get(
    '/fixtures/:fixtureId/eligibility',
    authed,
    validateRequest({ params: fixtureIdParams, query: noQuery }),
    controller.eligibility,
  );

  return { router, service };
}

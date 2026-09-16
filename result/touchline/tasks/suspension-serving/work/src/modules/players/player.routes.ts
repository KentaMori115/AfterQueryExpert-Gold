/** Wires the player routes, each with the schema it validates against. */
import { Router } from 'express';
import type { Database } from '../../db/client';
import { requireAuth, requireScope } from '../../middleware/requireAuth';
import { validateRequest } from '../../middleware/validateRequest';
import type { AuthService } from '../auth/auth.service';
import type { ClubService } from '../clubs/club.service';
import { PlayerController } from './player.controller';
import { PlayerRepository } from './player.repository';
import {
  clubIdParams,
  listPlayersQuery,
  noQuery,
  playerIdParams,
  registerPlayerBody,
  releasePlayerBody,
  transferPlayerBody,
  updatePlayerBody,
} from './player.schema';
import { PlayerService } from './player.service';

export interface PlayerModule {
  router: Router;
  service: PlayerService;
}

export function buildPlayerModule(
  db: Database,
  auth: AuthService,
  clubs: ClubService,
): PlayerModule {
  const service = new PlayerService(new PlayerRepository(db), clubs);
  const controller = new PlayerController(service);
  const router = Router();
  const authed = requireAuth(auth);
  const mayRegister = requireScope('registrations');

  router.post(
    '/clubs/:clubId/players',
    authed,
    mayRegister,
    validateRequest({ params: clubIdParams, body: registerPlayerBody, query: noQuery }),
    controller.register,
  );

  router.get(
    '/clubs/:clubId/players',
    authed,
    validateRequest({ params: clubIdParams, query: listPlayersQuery }),
    controller.listForClub,
  );

  router.get('/players', authed, validateRequest({ query: listPlayersQuery }), controller.list);

  router.get(
    '/players/:playerId',
    authed,
    validateRequest({ params: playerIdParams, query: noQuery }),
    controller.read,
  );

  router.patch(
    '/players/:playerId',
    authed,
    mayRegister,
    validateRequest({ params: playerIdParams, body: updatePlayerBody, query: noQuery }),
    controller.update,
  );

  router.post(
    '/players/:playerId/release',
    authed,
    mayRegister,
    validateRequest({ params: playerIdParams, body: releasePlayerBody, query: noQuery }),
    controller.release,
  );

  router.post(
    '/players/:playerId/transfer',
    authed,
    mayRegister,
    validateRequest({ params: playerIdParams, body: transferPlayerBody, query: noQuery }),
    controller.transfer,
  );

  return { router, service };
}

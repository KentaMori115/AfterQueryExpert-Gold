/**
 * Wires the audit routes.
 *
 * Reading the trail sits behind the staff scope rather than being open to every
 * signed-in colleague: it says who did what, and that is the secretary's to
 * look at rather than anybody who happens to hold a token.
 */
import { Router } from 'express';
import type { Database } from '../../db/client';
import { requireAuth, requireScope } from '../../middleware/requireAuth';
import { validateRequest } from '../../middleware/validateRequest';
import type { AuthService } from '../auth/auth.service';
import { AuditController } from './audit.controller';
import { AuditRepository } from './audit.repository';
import { entryIdParams, listAuditQuery, noQuery } from './audit.schema';
import { AuditService } from './audit.service';

export interface AuditModule {
  router: Router;
  service: AuditService;
}

export function buildAuditModule(db: Database, auth: AuthService): AuditModule {
  const service = new AuditService(new AuditRepository(db));
  const controller = new AuditController(service);
  const router = Router();
  const authed = requireAuth(auth);
  const mayLook = requireScope('staff');

  router.get(
    '/audit',
    authed,
    mayLook,
    validateRequest({ query: listAuditQuery }),
    controller.list,
  );

  router.get(
    '/audit/:entryId',
    authed,
    mayLook,
    validateRequest({ params: entryIdParams, query: noQuery }),
    controller.read,
  );

  return { router, service };
}

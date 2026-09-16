/**
 * Writes the audit line once the response has gone out.
 *
 * It hangs off the response finishing rather than wrapping the handler, so a
 * request that was refused deep inside a service still leaves a line, and so
 * the status recorded is the one the caller actually saw.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from '../../lib/logger';
import type { AuditService } from './audit.service';
import { isAuditedMethod } from './audit.types';

export function auditWrites(audit: AuditService): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isAuditedMethod(req.method)) {
      next();
      return;
    }
    // The body is read here, before a handler has had the chance to replace it
    // with its parsed form, so the keys recorded are the ones that were sent.
    const sent: unknown = req.body;
    res.on('finish', () => {
      try {
        audit.record({
          staffId: req.staff?.id ?? null,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          body: sent,
        });
      } catch (err) {
        // An audit line failing must never take the request down with it.
        logger.error('could not write an audit line', {
          reason: err instanceof Error ? err.message : String(err),
          path: req.path,
        });
      }
    });
    next();
  };
}

/** Turns a request into a call on the audit service and back again. */
import type { NextFunction, Request, Response } from 'express';
import type { AuditService } from './audit.service';
import type { ListAuditQuery } from './audit.schema';

export class AuditController {
  constructor(private readonly service: AuditService) {}

  list = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json({ items: this.service.list(req.query as unknown as ListAuditQuery) });
    } catch (err) {
      next(err);
    }
  };

  read = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json(this.service.get(Number(req.params.entryId)));
    } catch (err) {
      next(err);
    }
  };
}

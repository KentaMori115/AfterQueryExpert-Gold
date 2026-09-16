/** Turns a request into a call on the suspension service and back again. */
import type { NextFunction, Request, Response } from 'express';
import type { LedgerQuery } from './suspension.schema';
import type { SuspensionService } from './suspension.service';

export class SuspensionController {
  constructor(private readonly service: SuspensionService) {}

  ledger = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const query = req.query as unknown as LedgerQuery;
      res.json(this.service.ledger(Number(req.params.playerId), query.asOf));
    } catch (err) {
      next(err);
    }
  };

  eligibility = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json(this.service.eligibility(Number(req.params.fixtureId)));
    } catch (err) {
      next(err);
    }
  };
}

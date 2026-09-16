/** Turns a request into a call on the standing service and back again. */
import type { NextFunction, Request, Response } from 'express';
import type { StandingService } from './standing.service';
import type { TableQuery } from './standing.schema';

export class StandingController {
  constructor(private readonly service: StandingService) {}

  table = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const query = req.query as unknown as TableQuery;
      res.json(this.service.table(Number(req.params.divisionId), query.asOf));
    } catch (err) {
      next(err);
    }
  };
}

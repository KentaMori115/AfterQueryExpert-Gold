/** Turns a request into a call on the division service and back again. */
import type { NextFunction, Request, Response } from 'express';
import type { DivisionService } from './division.service';
import type {
  CompleteDivisionBody,
  CreateDivisionBody,
  FixDivisionBody,
  ListDivisionsQuery,
  UpdateDivisionBody,
} from './division.schema';

export class DivisionController {
  constructor(private readonly service: DivisionService) {}

  create = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as CreateDivisionBody;
      res.status(201).json(this.service.create(Number(req.params.seasonId), body));
    } catch (err) {
      next(err);
    }
  };

  listForSeason = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const query = req.query as unknown as ListDivisionsQuery;
      res.json({
        items: this.service.list({ seasonId: Number(req.params.seasonId), ...query }),
      });
    } catch (err) {
      next(err);
    }
  };

  list = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json({ items: this.service.list(req.query as unknown as ListDivisionsQuery) });
    } catch (err) {
      next(err);
    }
  };

  read = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json(this.service.get(Number(req.params.divisionId)));
    } catch (err) {
      next(err);
    }
  };

  update = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as UpdateDivisionBody;
      res.json(this.service.update(Number(req.params.divisionId), body));
    } catch (err) {
      next(err);
    }
  };

  fix = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as FixDivisionBody;
      res.json(this.service.fix(Number(req.params.divisionId), body.fixedOn));
    } catch (err) {
      next(err);
    }
  };

  complete = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as CompleteDivisionBody;
      res.json(this.service.complete(Number(req.params.divisionId), body.completedOn));
    } catch (err) {
      next(err);
    }
  };
}

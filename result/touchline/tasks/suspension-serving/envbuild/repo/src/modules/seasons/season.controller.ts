/** Turns a request into a call on the season service and back again. */
import type { NextFunction, Request, Response } from 'express';
import type { SeasonService } from './season.service';
import type {
  CloseSeasonBody,
  CreateSeasonBody,
  ListSeasonsQuery,
  OpenSeasonBody,
  UpdateSeasonBody,
} from './season.schema';

export class SeasonController {
  constructor(private readonly service: SeasonService) {}

  create = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.status(201).json(this.service.create(req.body as CreateSeasonBody));
    } catch (err) {
      next(err);
    }
  };

  read = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json(this.service.get(Number(req.params.seasonId)));
    } catch (err) {
      next(err);
    }
  };

  list = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const query = req.query as unknown as ListSeasonsQuery;
      res.json({ items: this.service.list(query) });
    } catch (err) {
      next(err);
    }
  };

  update = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json(this.service.update(Number(req.params.seasonId), req.body as UpdateSeasonBody));
    } catch (err) {
      next(err);
    }
  };

  open = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as OpenSeasonBody;
      res.json(this.service.open(Number(req.params.seasonId), body.openedOn));
    } catch (err) {
      next(err);
    }
  };

  close = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as CloseSeasonBody;
      res.json(this.service.close(Number(req.params.seasonId), body.closedOn));
    } catch (err) {
      next(err);
    }
  };
}

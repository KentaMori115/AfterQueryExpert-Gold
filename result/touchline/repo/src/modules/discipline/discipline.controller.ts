/** Turns a request into a call on the discipline service and back again. */
import type { NextFunction, Request, Response } from 'express';
import type { DisciplineService } from './discipline.service';
import type {
  ListCardsQuery,
  RecordQuery,
  RescindCardBody,
  ShowCardBody,
} from './discipline.schema';

export class DisciplineController {
  constructor(private readonly service: DisciplineService) {}

  show = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as ShowCardBody;
      res.status(201).json(this.service.show(Number(req.params.fixtureId), body));
    } catch (err) {
      next(err);
    }
  };

  listForFixture = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const query = req.query as unknown as ListCardsQuery;
      res.json({ items: this.service.list({ fixtureId: Number(req.params.fixtureId), ...query }) });
    } catch (err) {
      next(err);
    }
  };

  list = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json({ items: this.service.list(req.query as unknown as ListCardsQuery) });
    } catch (err) {
      next(err);
    }
  };

  read = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json(this.service.get(Number(req.params.cardId)));
    } catch (err) {
      next(err);
    }
  };

  rescind = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as RescindCardBody;
      res.json(this.service.rescind(Number(req.params.cardId), body.rescindedOn));
    } catch (err) {
      next(err);
    }
  };

  record = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const query = req.query as unknown as RecordQuery;
      res.json(this.service.record(Number(req.params.playerId), query.asOf));
    } catch (err) {
      next(err);
    }
  };
}

/** Turns a request into a call on the fixture service and back again. */
import type { NextFunction, Request, Response } from 'express';
import type { FixtureService } from './fixture.service';
import type {
  AbandonFixtureBody,
  AwardFixtureBody,
  ListFixturesQuery,
  PostponeFixtureBody,
  RescheduleFixtureBody,
  ScheduleFixtureBody,
} from './fixture.schema';

export class FixtureController {
  constructor(private readonly service: FixtureService) {}

  schedule = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as ScheduleFixtureBody;
      res.status(201).json(this.service.schedule(Number(req.params.divisionId), body));
    } catch (err) {
      next(err);
    }
  };

  listForDivision = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const query = req.query as unknown as ListFixturesQuery;
      res.json({
        items: this.service.list({ divisionId: Number(req.params.divisionId), ...query }),
      });
    } catch (err) {
      next(err);
    }
  };

  list = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json({ items: this.service.list(req.query as unknown as ListFixturesQuery) });
    } catch (err) {
      next(err);
    }
  };

  read = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json(this.service.get(Number(req.params.fixtureId)));
    } catch (err) {
      next(err);
    }
  };

  postpone = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as PostponeFixtureBody;
      res.json(this.service.postpone(Number(req.params.fixtureId), body.postponedOn));
    } catch (err) {
      next(err);
    }
  };

  abandon = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as AbandonFixtureBody;
      res.json(this.service.abandon(Number(req.params.fixtureId), body.abandonedOn));
    } catch (err) {
      next(err);
    }
  };

  reschedule = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as RescheduleFixtureBody;
      res.json(this.service.reschedule(Number(req.params.fixtureId), body));
    } catch (err) {
      next(err);
    }
  };

  award = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as AwardFixtureBody;
      res.json(this.service.award(Number(req.params.fixtureId), body));
    } catch (err) {
      next(err);
    }
  };
}

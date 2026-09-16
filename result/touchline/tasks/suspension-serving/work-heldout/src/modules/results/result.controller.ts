/** Turns a request into a call on the result service and back again. */
import type { NextFunction, Request, Response } from 'express';
import type { ResultService } from './result.service';
import type {
  ConfirmResultBody,
  DisputeResultBody,
  ListResultsQuery,
  ReportResultBody,
  SettleResultBody,
} from './result.schema';

export class ResultController {
  constructor(private readonly service: ResultService) {}

  report = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as ReportResultBody;
      res.status(201).json(this.service.report(Number(req.params.fixtureId), body));
    } catch (err) {
      next(err);
    }
  };

  readForFixture = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json(this.service.forFixture(Number(req.params.fixtureId)));
    } catch (err) {
      next(err);
    }
  };

  read = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json(this.service.get(Number(req.params.resultId)));
    } catch (err) {
      next(err);
    }
  };

  list = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json({ items: this.service.list(req.query as unknown as ListResultsQuery) });
    } catch (err) {
      next(err);
    }
  };

  confirm = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as ConfirmResultBody;
      res.json(this.service.confirm(Number(req.params.resultId), body));
    } catch (err) {
      next(err);
    }
  };

  dispute = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as DisputeResultBody;
      res.json(this.service.dispute(Number(req.params.resultId), body));
    } catch (err) {
      next(err);
    }
  };

  settle = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as SettleResultBody;
      res.json(this.service.settle(Number(req.params.resultId), body));
    } catch (err) {
      next(err);
    }
  };
}

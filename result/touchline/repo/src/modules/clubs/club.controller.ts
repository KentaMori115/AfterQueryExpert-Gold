/** Turns a request into a call on the club service and back again. */
import type { NextFunction, Request, Response } from 'express';
import type { ClubService } from './club.service';
import type {
  AdmitClubBody,
  CreateClubBody,
  ListClubsQuery,
  ReinstateClubBody,
  ResignClubBody,
  SuspendClubBody,
  UpdateClubBody,
} from './club.schema';

export class ClubController {
  constructor(private readonly service: ClubService) {}

  create = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.status(201).json(this.service.create(req.body as CreateClubBody));
    } catch (err) {
      next(err);
    }
  };

  read = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json(this.service.get(Number(req.params.clubId)));
    } catch (err) {
      next(err);
    }
  };

  list = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json({ items: this.service.list(req.query as unknown as ListClubsQuery) });
    } catch (err) {
      next(err);
    }
  };

  update = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json(this.service.update(Number(req.params.clubId), req.body as UpdateClubBody));
    } catch (err) {
      next(err);
    }
  };

  admit = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as AdmitClubBody;
      res.json(this.service.admit(Number(req.params.clubId), body.admittedOn));
    } catch (err) {
      next(err);
    }
  };

  suspend = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as SuspendClubBody;
      res.json(this.service.suspend(Number(req.params.clubId), body.suspendedOn));
    } catch (err) {
      next(err);
    }
  };

  reinstate = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as ReinstateClubBody;
      res.json(this.service.reinstate(Number(req.params.clubId), body.reinstatedOn));
    } catch (err) {
      next(err);
    }
  };

  resign = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as ResignClubBody;
      res.json(this.service.resign(Number(req.params.clubId), body.leftOn));
    } catch (err) {
      next(err);
    }
  };
}

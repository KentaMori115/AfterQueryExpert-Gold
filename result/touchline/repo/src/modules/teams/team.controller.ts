/** Turns a request into a call on the team service and back again. */
import type { NextFunction, Request, Response } from 'express';
import type { TeamService } from './team.service';
import type { EnterTeamBody, ListTeamsQuery, MoveTeamBody, WithdrawTeamBody } from './team.schema';

export class TeamController {
  constructor(private readonly service: TeamService) {}

  enter = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as EnterTeamBody;
      res.status(201).json(this.service.enter(Number(req.params.divisionId), body));
    } catch (err) {
      next(err);
    }
  };

  listForDivision = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const query = req.query as unknown as ListTeamsQuery;
      res.json({
        items: this.service.list({ divisionId: Number(req.params.divisionId), ...query }),
      });
    } catch (err) {
      next(err);
    }
  };

  list = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json({ items: this.service.list(req.query as unknown as ListTeamsQuery) });
    } catch (err) {
      next(err);
    }
  };

  read = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json(this.service.get(Number(req.params.teamId)));
    } catch (err) {
      next(err);
    }
  };

  withdraw = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as WithdrawTeamBody;
      res.json(this.service.withdraw(Number(req.params.teamId), body.withdrawnOn));
    } catch (err) {
      next(err);
    }
  };

  move = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as MoveTeamBody;
      res.json(this.service.move(Number(req.params.teamId), body.divisionId));
    } catch (err) {
      next(err);
    }
  };
}

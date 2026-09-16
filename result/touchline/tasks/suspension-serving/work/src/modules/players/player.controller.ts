/** Turns a request into a call on the player service and back again. */
import type { NextFunction, Request, Response } from 'express';
import type { PlayerService } from './player.service';
import type {
  ListPlayersQuery,
  RegisterPlayerBody,
  ReleasePlayerBody,
  TransferPlayerBody,
  UpdatePlayerBody,
} from './player.schema';

export class PlayerController {
  constructor(private readonly service: PlayerService) {}

  register = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as RegisterPlayerBody;
      res.status(201).json(this.service.register(Number(req.params.clubId), body));
    } catch (err) {
      next(err);
    }
  };

  listForClub = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const query = req.query as unknown as ListPlayersQuery;
      res.json({ items: this.service.list({ clubId: Number(req.params.clubId), ...query }) });
    } catch (err) {
      next(err);
    }
  };

  list = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json({ items: this.service.list(req.query as unknown as ListPlayersQuery) });
    } catch (err) {
      next(err);
    }
  };

  read = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json(this.service.get(Number(req.params.playerId)));
    } catch (err) {
      next(err);
    }
  };

  update = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as UpdatePlayerBody;
      res.json(this.service.update(Number(req.params.playerId), body));
    } catch (err) {
      next(err);
    }
  };

  release = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as ReleasePlayerBody;
      res.json(this.service.release(Number(req.params.playerId), body.releasedOn));
    } catch (err) {
      next(err);
    }
  };

  transfer = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as TransferPlayerBody;
      res.json(this.service.transfer(Number(req.params.playerId), body));
    } catch (err) {
      next(err);
    }
  };
}

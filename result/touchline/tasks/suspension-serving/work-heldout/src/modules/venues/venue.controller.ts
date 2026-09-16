/** Turns a request into a call on the venue service and back again. */
import type { NextFunction, Request, Response } from 'express';
import type { VenueService } from './venue.service';
import type {
  CloseVenueBody,
  CreateVenueBody,
  ListVenuesQuery,
  UpdateVenueBody,
} from './venue.schema';

export class VenueController {
  constructor(private readonly service: VenueService) {}

  create = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.status(201).json(this.service.create(req.body as CreateVenueBody));
    } catch (err) {
      next(err);
    }
  };

  read = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json(this.service.get(Number(req.params.venueId)));
    } catch (err) {
      next(err);
    }
  };

  list = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json({ items: this.service.list(req.query as unknown as ListVenuesQuery) });
    } catch (err) {
      next(err);
    }
  };

  update = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json(this.service.update(Number(req.params.venueId), req.body as UpdateVenueBody));
    } catch (err) {
      next(err);
    }
  };

  close = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as CloseVenueBody;
      res.json(this.service.close(Number(req.params.venueId), body.closedOn));
    } catch (err) {
      next(err);
    }
  };

  reopen = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json(this.service.reopen(Number(req.params.venueId)));
    } catch (err) {
      next(err);
    }
  };
}

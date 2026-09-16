/**
 * Turns a request into a call on the service and the answer into a response.
 * No rule about the league lives here.
 */
import type { NextFunction, Request, Response } from 'express';
import { staffOn } from '../../middleware/requireAuth';
import type { AuthService } from './auth.service';
import type { CreateStaffBody, ListStaffQuery, SignInBody, UpdateStaffBody } from './auth.schema';

export class AuthController {
  constructor(private readonly service: AuthService) {}

  signIn = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as SignInBody;
      const signedIn = this.service.signIn(body.email, body.password);
      res.status(201).json(signedIn);
    } catch (err) {
      next(err);
    }
  };

  signOut = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const header = req.header('authorization') ?? '';
      const token = header.split(' ')[1] ?? '';
      const session = this.service.signOut(token);
      res.json({ endedAt: session.endedAt });
    } catch (err) {
      next(err);
    }
  };

  me = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json(staffOn(req));
    } catch (err) {
      next(err);
    }
  };

  create = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as CreateStaffBody;
      res.status(201).json(this.service.createStaff(body));
    } catch (err) {
      next(err);
    }
  };

  read = (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.json(this.service.getStaff(Number(req.params.staffId)));
    } catch (err) {
      next(err);
    }
  };

  list = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const query = req.query as unknown as ListStaffQuery;
      res.json({ items: this.service.listStaff(query) });
    } catch (err) {
      next(err);
    }
  };

  update = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const body = req.body as UpdateStaffBody;
      res.json(this.service.updateStaff(Number(req.params.staffId), body));
    } catch (err) {
      next(err);
    }
  };
}

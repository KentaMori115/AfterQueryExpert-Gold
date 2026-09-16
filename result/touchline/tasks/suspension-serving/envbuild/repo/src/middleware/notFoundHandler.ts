/** Anything that reached the end of the routing table is not here. */
import type { NextFunction, Request, Response } from 'express';
import { NotFoundError } from '../lib/AppError';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`There is nothing at ${req.method} ${req.path}`));
}

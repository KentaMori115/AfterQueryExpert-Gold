/**
 * Puts the signed-in staff member on the request, or refuses it.
 *
 * Every route in the service sits behind this, including the ones that only
 * read: the league's fixtures and its disciplinary record are not public.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ConflictError, UnauthorisedError } from '../lib/AppError';
import type { AuthService } from '../modules/auth/auth.service';
import { ROLE_SCOPES, type Staff } from '../modules/auth/auth.types';

declare module 'express-serve-static-core' {
  interface Request {
    staff?: Staff;
  }
}

function bearerFrom(header: string | undefined): string {
  if (header === undefined) throw new UnauthorisedError('This route needs a bearer token');
  const parts = header.split(' ');
  const scheme = parts[0];
  const token = parts[1];
  if (parts.length !== 2 || scheme !== 'Bearer' || token === undefined || token === '') {
    throw new UnauthorisedError('The Authorization header must read "Bearer <token>"');
  }
  return token;
}

export function requireAuth(auth: AuthService): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.staff = auth.staffForToken(bearerFrom(req.header('authorization') ?? undefined));
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** The staff member on a request that has already been through requireAuth. */
export function staffOn(req: Request): Staff {
  const staff = req.staff;
  if (staff === undefined) throw new UnauthorisedError('This route needs a bearer token');
  return staff;
}

/**
 * Refuses a writer whose role does not cover this part of the league.
 *
 * A role that may not write here is a 409 rather than a 401: the caller is who
 * they say they are, the league just does not let them settle this.
 */
export function requireScope(scope: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const staff = staffOn(req);
      if (!ROLE_SCOPES[staff.role].includes(scope)) {
        throw new ConflictError(`A ${staff.role} may not settle ${scope}`, {
          role: staff.role,
          scope,
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Validates a request against a schema before a handler ever sees it.
 *
 * Every body and every query is `.strict()`, including routes that take no
 * filters of their own: a caller who invents a field has almost certainly
 * misread the contract, and answering 200 to a request the service quietly
 * ignored is worse than refusing it.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { BadRequestError } from '../lib/AppError';

export interface RequestSchemas {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
}

function complain(where: string, err: ZodError): never {
  const first = err.issues[0];
  const path = first && first.path.length > 0 ? first.path.join('.') : where;
  const message = first ? `${path}: ${first.message}` : `${where} will not parse`;
  throw new BadRequestError(message, {
    where,
    issues: err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
}

export function validateRequest(schemas: RequestSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) {
        const parsed = schemas.params.safeParse(req.params);
        if (!parsed.success) complain('params', parsed.error);
        req.params = parsed.data as typeof req.params;
      }
      if (schemas.query) {
        const parsed = schemas.query.safeParse(req.query);
        if (!parsed.success) complain('query', parsed.error);
        // Express 4 lets the parsed query be assigned back; later handlers read
        // the coerced values rather than the raw strings.
        Object.defineProperty(req, 'query', { value: parsed.data, configurable: true });
      }
      if (schemas.body) {
        const parsed = schemas.body.safeParse(req.body);
        if (!parsed.success) complain('body', parsed.error);
        req.body = parsed.data;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

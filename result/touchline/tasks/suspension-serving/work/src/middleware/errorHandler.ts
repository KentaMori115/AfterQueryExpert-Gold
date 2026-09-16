/**
 * Answers a thrown error as JSON, in one shape, whatever threw it.
 *
 * Anything that is not an AppError is a bug in this service, so it answers 500
 * and says nothing about itself beyond that.
 */
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/AppError';
import { logger } from '../lib/logger';

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    const body: ErrorBody = {
      error: { code: err.code, message: err.message, details: err.details },
    };
    res.status(err.status).json(body);
    return;
  }

  logger.error('unhandled failure', {
    reason: err instanceof Error ? err.message : String(err),
  });
  const body: ErrorBody = {
    error: { code: 'internal', message: 'Something in the service went wrong', details: {} },
  };
  res.status(500).json(body);
}

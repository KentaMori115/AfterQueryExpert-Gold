/** Logs every request as it finishes, with the status it finished on. */
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const tookMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    logger.info('request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      tookMs: Math.round(tookMs * 100) / 100,
    });
  });
  next();
}

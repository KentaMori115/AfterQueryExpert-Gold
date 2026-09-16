/**
 * Logs as JSON lines, so a run can be read by a person or by a machine without
 * either of them having to guess where a field starts.
 */
import { env, type LogLevel } from '../config/env';

const RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

function write(
  level: Exclude<LogLevel, 'silent'>,
  message: string,
  fields: Record<string, unknown>,
): void {
  if (RANK[level] < RANK[env.logLevel]) return;
  const line = JSON.stringify({ level, message, ...fields });
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (message: string, fields: Record<string, unknown> = {}) => write('debug', message, fields),
  info: (message: string, fields: Record<string, unknown> = {}) => write('info', message, fields),
  warn: (message: string, fields: Record<string, unknown> = {}) => write('warn', message, fields),
  error: (message: string, fields: Record<string, unknown> = {}) => write('error', message, fields),
};

/**
 * Everything the service needs from its surroundings, read once at startup.
 *
 * Defaults are chosen so a fresh checkout runs without an .env file: the
 * database lives in memory, which is also what the tests want.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];

export interface Env {
  port: number;
  databaseFile: string;
  logLevel: LogLevel;
  nodeEnv: string;
}

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 3000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a port number, not ${raw}`);
  }
  return port;
}

function readLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined || raw.trim() === '') return 'info';
  const found = LOG_LEVELS.find((level) => level === raw);
  if (found === undefined) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, not ${raw}`);
  }
  return found;
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return {
    port: readPort(source.PORT),
    databaseFile: source.DATABASE_FILE ?? ':memory:',
    logLevel: readLogLevel(source.LOG_LEVEL),
    nodeEnv: source.NODE_ENV ?? 'development',
  };
}

export const env: Env = readEnv();

/**
 * Opens a SQLite database and lays the schema down.
 *
 * `node:sqlite` is used rather than a native driver so a checkout builds with
 * nothing but npm: no compiler, no build tools, no prebuilt binaries to go
 * missing on someone else's machine.
 */
import { DatabaseSync } from 'node:sqlite';
import { env } from '../config/env';
import { SCHEMA } from './schema';

export type Database = DatabaseSync;

/** A row as SQLite hands it back, before a repository maps it to a domain shape. */
export type Row = Record<string, unknown>;

export function openDatabase(file: string = env.databaseFile): Database {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

/** The moment a write happened, stored as an ISO instant. Rows carry these; the league argues in days. */
export function now(): string {
  return new Date().toISOString();
}

/**
 * `node:sqlite` hands rows back as Record<string, SQLOutputValue>, which does
 * not overlap a declared Row shape well enough for a direct cast. Repositories
 * funnel reads through these two so the widening happens in one place with the
 * intent written down, rather than as a scattering of double casts.
 */
export function asRows<T>(list: unknown): T[] {
  return list as T[];
}

export function asRow<T>(value: unknown): T | undefined {
  return value as T | undefined;
}

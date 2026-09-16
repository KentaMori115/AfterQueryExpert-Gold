export const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  sequence INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  at INTEGER NOT NULL,
  stream_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  explanation TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_sequence INTEGER NOT NULL,
  state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  document TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  document TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL,
  document TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scores (
  score_key TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  document TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rewards (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  document TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seasons (
  id TEXT PRIMARY KEY,
  document TEXT NOT NULL
);
`;

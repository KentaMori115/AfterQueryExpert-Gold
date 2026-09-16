/**
 * The whole schema, laid down on every open.
 *
 * Days are TEXT in `YYYY-MM-DD`. Instants are TEXT in ISO. Money is INTEGER
 * pence. Nothing here stores a float, and nothing stores a boolean as anything
 * other than 0 or 1.
 */

const STAFF = `
CREATE TABLE IF NOT EXISTS staff (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT    NOT NULL UNIQUE,
  full_name   TEXT    NOT NULL,
  role        TEXT    NOT NULL,
  password    TEXT    NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id    INTEGER NOT NULL REFERENCES staff(id),
  token       TEXT    NOT NULL UNIQUE,
  issued_at   TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,
  ended_at    TEXT
);
`;

const SEASONS = `
CREATE TABLE IF NOT EXISTS seasons (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  name                    TEXT    NOT NULL UNIQUE,
  starts_on               TEXT    NOT NULL,
  ends_on                 TEXT    NOT NULL,
  registration_closes_on  TEXT    NOT NULL,
  status                  TEXT    NOT NULL,
  points_win              INTEGER NOT NULL,
  points_draw             INTEGER NOT NULL,
  points_loss             INTEGER NOT NULL,
  opened_on               TEXT,
  closed_on               TEXT,
  created_at              TEXT    NOT NULL,
  updated_at              TEXT    NOT NULL
);
`;

const VENUES = `
CREATE TABLE IF NOT EXISTS venues (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  address_line  TEXT    NOT NULL,
  postcode      TEXT    NOT NULL,
  surface       TEXT    NOT NULL,
  pitch_count   INTEGER NOT NULL,
  floodlit      INTEGER NOT NULL,
  status        TEXT    NOT NULL,
  closed_on     TEXT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  UNIQUE (name, postcode)
);
`;

const CLUBS = `
CREATE TABLE IF NOT EXISTS clubs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL UNIQUE,
  short_name     TEXT    NOT NULL UNIQUE,
  founded_year   INTEGER NOT NULL,
  contact_email  TEXT    NOT NULL,
  home_venue_id  INTEGER REFERENCES venues(id),
  status         TEXT    NOT NULL,
  applied_on     TEXT    NOT NULL,
  admitted_on    TEXT,
  left_on        TEXT,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL
);
`;

const DIVISIONS = `
CREATE TABLE IF NOT EXISTS divisions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id          INTEGER NOT NULL REFERENCES seasons(id),
  name               TEXT    NOT NULL,
  tier               INTEGER NOT NULL,
  team_capacity      INTEGER NOT NULL,
  promotion_places   INTEGER NOT NULL,
  relegation_places  INTEGER NOT NULL,
  status             TEXT    NOT NULL,
  fixed_on           TEXT,
  completed_on       TEXT,
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL,
  UNIQUE (season_id, name),
  UNIQUE (season_id, tier)
);
`;

const TEAMS = `
CREATE TABLE IF NOT EXISTS teams (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id       INTEGER NOT NULL REFERENCES clubs(id),
  division_id   INTEGER NOT NULL REFERENCES divisions(id),
  rank          TEXT    NOT NULL,
  status        TEXT    NOT NULL,
  entered_on    TEXT    NOT NULL,
  withdrawn_on  TEXT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);
`;

const PLAYERS = `
CREATE TABLE IF NOT EXISTS players (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id        INTEGER NOT NULL REFERENCES clubs(id),
  first_name     TEXT    NOT NULL,
  last_name      TEXT    NOT NULL,
  born_on        TEXT    NOT NULL,
  position       TEXT    NOT NULL,
  squad_number   INTEGER NOT NULL,
  status         TEXT    NOT NULL,
  registered_on  TEXT    NOT NULL,
  released_on    TEXT,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL
);
`;

const FIXTURES = `
CREATE TABLE IF NOT EXISTS fixtures (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  division_id   INTEGER NOT NULL REFERENCES divisions(id),
  home_team_id  INTEGER NOT NULL REFERENCES teams(id),
  away_team_id  INTEGER NOT NULL REFERENCES teams(id),
  venue_id      INTEGER NOT NULL REFERENCES venues(id),
  played_on           TEXT    NOT NULL,
  kick_off            TEXT    NOT NULL,
  status              TEXT    NOT NULL,
  postponed_on        TEXT,
  awarded_to_team_id  INTEGER REFERENCES teams(id),
  award_reason        TEXT,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL
);
`;

const RESULTS = `
CREATE TABLE IF NOT EXISTS results (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  fixture_id           INTEGER NOT NULL UNIQUE REFERENCES fixtures(id),
  home_goals           INTEGER NOT NULL,
  away_goals           INTEGER NOT NULL,
  reported_by_team_id  INTEGER NOT NULL REFERENCES teams(id),
  reported_on          TEXT    NOT NULL,
  status               TEXT    NOT NULL,
  answered_by_team_id  INTEGER REFERENCES teams(id),
  answered_on          TEXT,
  settled_on           TEXT,
  note                 TEXT,
  created_at           TEXT    NOT NULL,
  updated_at           TEXT    NOT NULL
);
`;

const CARDS = `
CREATE TABLE IF NOT EXISTS cards (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  fixture_id        INTEGER NOT NULL REFERENCES fixtures(id),
  player_id         INTEGER NOT NULL REFERENCES players(id),
  team_id           INTEGER NOT NULL REFERENCES teams(id),
  offence           TEXT    NOT NULL,
  colour            TEXT    NOT NULL,
  points            INTEGER NOT NULL,
  fine_pence        INTEGER NOT NULL,
  straight_ban      INTEGER NOT NULL,
  accumulation_ban  INTEGER NOT NULL,
  running_points    INTEGER NOT NULL,
  status            TEXT    NOT NULL,
  shown_on          TEXT    NOT NULL,
  rescinded_on      TEXT,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);
`;

const AUDIT = `
CREATE TABLE IF NOT EXISTS audit_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id     INTEGER REFERENCES staff(id),
  method       TEXT    NOT NULL,
  path         TEXT    NOT NULL,
  status       INTEGER NOT NULL,
  outcome      TEXT    NOT NULL,
  body_keys    TEXT    NOT NULL,
  happened_at  TEXT    NOT NULL
);
`;

export const SCHEMA = [
  STAFF,
  SEASONS,
  VENUES,
  CLUBS,
  DIVISIONS,
  TEAMS,
  PLAYERS,
  FIXTURES,
  RESULTS,
  CARDS,
  AUDIT,
].join('\n');

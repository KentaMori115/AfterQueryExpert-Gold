/**
 * Builds the Express application around one open database.
 *
 * The database is passed in rather than reached for, so a test can stand a
 * whole service up against its own in-memory database and throw it away again.
 *
 * The modules are built in dependency order, each handed the services it needs
 * rather than reaching for them, so the wiring is visible in one place.
 */
import express, { type Express } from 'express';
import type { Database } from './db/client';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import { requestLogger } from './middleware/requestLogger';
import { auditWrites } from './modules/audit/audit.middleware';
import { buildAuditModule } from './modules/audit/audit.routes';
import { buildAuthModule } from './modules/auth/auth.routes';
import { buildClubModule } from './modules/clubs/club.routes';
import { buildDisciplineModule } from './modules/discipline/discipline.routes';
import { buildDivisionModule } from './modules/divisions/division.routes';
import { buildFixtureModule } from './modules/fixtures/fixture.routes';
import { buildPlayerModule } from './modules/players/player.routes';
import { buildResultModule } from './modules/results/result.routes';
import { buildStandingModule } from './modules/standings/standing.routes';
import { buildSeasonModule } from './modules/seasons/season.routes';
import { buildSuspensionModule } from './modules/suspensions/suspension.routes';
import { buildTeamModule } from './modules/teams/team.routes';
import { buildVenueModule } from './modules/venues/venue.routes';

export interface AppDeps {
  db: Database;
}

export function buildApp({ db }: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const auth = buildAuthModule(db);
  const audit = buildAuditModule(db, auth.service);

  // The trail hangs off the response finishing, so it has to be in place before
  // any route runs. It reads the signed-in staff member from the request only
  // once the route that authenticated them has already done its work.
  app.use(auditWrites(audit.service));

  app.use(auth.router);

  const seasons = buildSeasonModule(db, auth.service);
  app.use(seasons.router);

  const venues = buildVenueModule(db, auth.service);
  app.use(venues.router);

  const clubs = buildClubModule(db, auth.service, venues.service);
  app.use(clubs.router);

  const players = buildPlayerModule(db, auth.service, clubs.service);
  app.use(players.router);

  const divisions = buildDivisionModule(db, auth.service, seasons.service);
  app.use(divisions.router);

  const teams = buildTeamModule(db, auth.service, divisions.service, clubs.service);
  app.use(teams.router);

  const fixtures = buildFixtureModule(
    db,
    auth.service,
    divisions.service,
    teams.service,
    venues.service,
    seasons.service,
  );
  app.use(fixtures.router);

  const results = buildResultModule(db, auth.service, fixtures.service);
  app.use(results.router);

  app.use(
    buildStandingModule(
      auth.service,
      divisions.service,
      teams.service,
      clubs.service,
      fixtures.service,
      results.service,
      seasons.service,
    ).router,
  );

  // Serving is read off cards and played games, and the record's standing is
  // read off serving, so the ledger comes before discipline in the wiring.
  const suspensions = buildSuspensionModule(
    db,
    auth.service,
    fixtures.service,
    players.service,
    teams.service,
  );
  app.use(suspensions.router);

  app.use(
    buildDisciplineModule(
      db,
      auth.service,
      fixtures.service,
      players.service,
      teams.service,
      suspensions.service,
    ).router,
  );

  app.use(audit.router);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

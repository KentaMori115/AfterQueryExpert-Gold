/**
 * Puts a small, complete league in a database so there is something to click
 * around in: a founding secretary, two grounds, four member clubs, a season
 * under way, one division with its entries fixed, two match days of fixtures,
 * and the earlier day's scores agreed by both sides.
 *
 * Everything is built through the same services the routes are built from,
 * rather than through SQL, so the seed cannot invent a league the API itself
 * would refuse: a rule that turns this data away over HTTP turns it away here
 * too, and the seed fails loudly instead of leaving something unreachable in
 * the database.
 *
 * NEVER run this against a database anybody is using. It deletes the file it is
 * pointed at before it writes anything, so the only safe target is a throwaway,
 * which is what it defaults to.
 *
 *   npx ts-node scripts/seed.ts
 *   DATABASE_FILE=./scratch.sqlite npx ts-node scripts/seed.ts
 */
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openDatabase } from '../src/db/client';
import { must } from '../src/lib/collections';
import { addDays } from '../src/lib/days';
import { AppError } from '../src/lib/AppError';
import { buildAuthModule } from '../src/modules/auth/auth.routes';
import { buildClubModule } from '../src/modules/clubs/club.routes';
import { buildDivisionModule } from '../src/modules/divisions/division.routes';
import { buildFixtureModule } from '../src/modules/fixtures/fixture.routes';
import { buildResultModule } from '../src/modules/results/result.routes';
import { buildSeasonModule } from '../src/modules/seasons/season.routes';
import { buildTeamModule } from '../src/modules/teams/team.routes';
import { buildVenueModule } from '../src/modules/venues/venue.routes';
import { displayName } from '../src/modules/teams/team.types';
import type { Venue } from '../src/modules/venues/venue.types';

/** The founder. There is nobody signed in yet to make one over HTTP, so this one is made directly. */
const FOUNDER = {
  email: 'secretary@touchline.example',
  fullName: 'Ada Fenwick',
  password: 'a-long-enough-secret',
} as const;

/**
 * Every day this league turns on, written down once. They are strings because
 * that is what the league argues in, and they are far enough in the future that
 * the seed reads the same whenever somebody runs it.
 */
const SEASON_STARTS = '2031-08-09';
const SEASON_ENDS = '2032-05-16';
const REGISTRATION_CLOSES = '2032-03-31';
const CLUBS_APPLIED_ON = '2031-06-01';
const CLUBS_ADMITTED_ON = '2031-07-01';
const TEAMS_ENTERED_ON = '2031-07-15';
const MATCH_DAY_ONE = '2031-09-06';
const MATCH_DAY_TWO = '2031-09-13';

/**
 * `src/config/env.ts` defaults DATABASE_FILE to `:memory:`, which is right for
 * the service and useless here, so this reads the variable with its own default:
 * a seed that vanishes when the process exits was not worth writing.
 */
function databaseFileFromEnv(): string {
  const fromEnv = process.env.DATABASE_FILE?.trim();
  if (fromEnv === undefined || fromEnv === '') return join(__dirname, '..', 'seed.sqlite');
  if (fromEnv === ':memory:') {
    throw new Error('DATABASE_FILE is :memory:, so there would be nothing left to look at');
  }
  return fromEnv;
}

/**
 * The schema is laid down with CREATE TABLE IF NOT EXISTS, so a second run at
 * the same file would collide with the first on every unique name. Simpler to
 * say the file is disposable and then dispose of it.
 */
function startFromEmpty(file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  for (const path of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) {
    rmSync(path, { force: true });
  }
}

interface ClubPlan {
  name: string;
  shortName: string;
  foundedYear: number;
  contactEmail: string;
  homeGround: 'marshLane' | 'kestrelPark';
}

const CLUB_PLANS: readonly ClubPlan[] = [
  {
    name: 'Ridgeway Rovers',
    shortName: 'RID',
    foundedYear: 1974,
    contactEmail: 'secretary@ridgewayrovers.example',
    homeGround: 'marshLane',
  },
  {
    name: 'Willow Athletic',
    shortName: 'WIL',
    foundedYear: 1908,
    contactEmail: 'secretary@willowathletic.example',
    homeGround: 'marshLane',
  },
  {
    name: 'Ashcroft Town',
    shortName: 'ASH',
    foundedYear: 1952,
    contactEmail: 'secretary@ashcrofttown.example',
    homeGround: 'kestrelPark',
  },
  {
    name: 'Brookend United',
    shortName: 'BRK',
    foundedYear: 1996,
    contactEmail: 'secretary@brookendunited.example',
    homeGround: 'kestrelPark',
  },
];

interface FixturePlan {
  /** Indexes into the four sides, in the order the clubs are listed above. */
  home: number;
  away: number;
  playedOn: string;
  kickOff: string;
  /** Present only for the earlier match day, which is the one that has been played. */
  score?: { homeGoals: number; awayGoals: number; reportedBy: 'home' | 'away' };
}

/**
 * Two rounds of a four-team division. Every game is at the home side's own
 * ground, which is what makes the late kick-offs legal: the two clubs at the 3G
 * can be lit and the two on grass cannot, so their games start at two.
 */
const FIXTURE_PLANS: readonly FixturePlan[] = [
  {
    home: 0,
    away: 1,
    playedOn: MATCH_DAY_ONE,
    kickOff: '14:00',
    score: { homeGoals: 2, awayGoals: 1, reportedBy: 'home' },
  },
  {
    home: 2,
    away: 3,
    playedOn: MATCH_DAY_ONE,
    kickOff: '15:30',
    score: { homeGoals: 0, awayGoals: 0, reportedBy: 'away' },
  },
  { home: 1, away: 2, playedOn: MATCH_DAY_TWO, kickOff: '14:00' },
  { home: 3, away: 0, playedOn: MATCH_DAY_TWO, kickOff: '15:30' },
];

function seed(file: string): void {
  startFromEmpty(file);
  const db = openDatabase(file);

  // The same wiring as src/app.ts, in the same dependency order, minus the HTTP.
  const auth = buildAuthModule(db);
  const seasons = buildSeasonModule(db, auth.service);
  const venues = buildVenueModule(db, auth.service);
  const clubs = buildClubModule(db, auth.service, venues.service);
  const divisions = buildDivisionModule(db, auth.service, seasons.service);
  const teams = buildTeamModule(db, auth.service, divisions.service, clubs.service);
  const fixtures = buildFixtureModule(
    db,
    auth.service,
    divisions.service,
    teams.service,
    venues.service,
    seasons.service,
  );
  const results = buildResultModule(db, auth.service, fixtures.service);

  const secretary = auth.service.createStaff({
    email: FOUNDER.email,
    fullName: FOUNDER.fullName,
    role: 'secretary',
    password: FOUNDER.password,
  });
  const signedIn = auth.service.signIn(FOUNDER.email, FOUNDER.password);

  const grounds: Record<ClubPlan['homeGround'], Venue> = {
    marshLane: venues.service.create({
      name: 'Marsh Lane Recreation Ground',
      addressLine: '14 Marsh Lane, Ridgeway',
      postcode: 'RG4 7QP',
      surface: 'grass',
      pitchCount: 2,
      floodlit: false,
    }),
    kestrelPark: venues.service.create({
      name: 'Kestrel Park 3G',
      addressLine: 'Kestrel Way, Ashcroft',
      postcode: 'AS2 9LT',
      surface: 'threeG',
      pitchCount: 2,
      floodlit: true,
    }),
  };

  // A club applies and is then admitted, because that is the only way to reach
  // membership, and only a member may enter a side.
  const members = CLUB_PLANS.map((plan) => {
    const applicant = clubs.service.create({
      name: plan.name,
      shortName: plan.shortName,
      foundedYear: plan.foundedYear,
      contactEmail: plan.contactEmail,
      homeVenueId: grounds[plan.homeGround].id,
      appliedOn: CLUBS_APPLIED_ON,
    });
    return clubs.service.admit(applicant.id, CLUBS_ADMITTED_ON);
  });

  const season = seasons.service.open(
    seasons.service.create({
      name: 'Season 2031-32',
      startsOn: SEASON_STARTS,
      endsOn: SEASON_ENDS,
      registrationClosesOn: REGISTRATION_CLOSES,
    }).id,
    SEASON_STARTS,
  );

  const forming = divisions.service.create(season.id, {
    name: 'Premier Division',
    tier: 1,
    teamCapacity: 4,
    promotionPlaces: 0,
    relegationPlaces: 1,
  });
  const sides = members.map((club, index) => ({
    club,
    plan: must(CLUB_PLANS, index, 'club plan'),
    team: teams.service.enter(forming.id, {
      clubId: club.id,
      rank: 'first',
      enteredOn: TEAMS_ENTERED_ON,
    }),
  }));
  // Nothing can be scheduled until the entries stop moving, so this is the line
  // that turns a list of clubs into a division somebody can play in.
  const division = divisions.service.fix(forming.id, SEASON_STARTS);

  const played = FIXTURE_PLANS.map((plan) => {
    const home = must(sides, plan.home, 'home side');
    const away = must(sides, plan.away, 'away side');
    const venue = grounds[home.plan.homeGround];
    const fixture = fixtures.service.schedule(division.id, {
      homeTeamId: home.team.id,
      awayTeamId: away.team.id,
      venueId: venue.id,
      playedOn: plan.playedOn,
      kickOff: plan.kickOff,
    });
    if (plan.score === undefined) return { plan, home, away, venue, fixture, scoreline: '' };

    // One side reports, the other agrees, and only then is the game played. The
    // two are reported from opposite ends so both halves of that rule are in the
    // seeded data rather than just one.
    const reporter = plan.score.reportedBy === 'home' ? home : away;
    const answerer = plan.score.reportedBy === 'home' ? away : home;
    const reported = results.service.report(fixture.id, {
      homeGoals: plan.score.homeGoals,
      awayGoals: plan.score.awayGoals,
      reportedByTeamId: reporter.team.id,
      reportedOn: plan.playedOn,
    });
    results.service.confirm(reported.id, {
      confirmedByTeamId: answerer.team.id,
      confirmedOn: addDays(plan.playedOn, 1),
    });
    return {
      plan,
      home,
      away,
      venue,
      // Read back rather than reused: agreeing the score is what moves a fixture
      // to played, and the copy captured above still says scheduled.
      fixture: fixtures.service.get(fixture.id),
      scoreline: `${plan.score.homeGoals}-${plan.score.awayGoals}`,
    };
  });

  const confirmed = played.filter((game) => game.scoreline !== '').length;

  console.log(`Seeded ${file}`);
  console.log('');
  console.log(`  staff     1  ${secretary.fullName}, ${secretary.role}`);
  const grounded = [grounds.marshLane, grounds.kestrelPark];
  console.log(`  venues    ${grounded.length}`);
  for (const venue of grounded) {
    console.log(
      `    ${venue.name} (${venue.surface}, ${venue.floodlit ? 'floodlit' : 'unlit'}, ` +
        `${venue.pitchCount} pitches)`,
    );
  }
  console.log(`  clubs     ${members.length}  ${members.map((club) => club.name).join(', ')}`);
  console.log(`  season    1  ${season.name}, ${season.status}, opened ${season.openedOn ?? ''}`);
  console.log(
    `  division  1  ${division.name}, tier ${division.tier}, ${division.status} ` +
      `${division.fixedOn ?? ''}, ${sides.length} sides`,
  );
  console.log(`  fixtures  ${played.length}  across ${MATCH_DAY_ONE} and ${MATCH_DAY_TWO}`);
  for (const game of played) {
    const homeName = displayName(game.home.club.name, game.home.team.rank);
    const awayName = displayName(game.away.club.name, game.away.team.rank);
    const middle = game.scoreline === '' ? 'v' : game.scoreline;
    console.log(
      `    ${game.plan.playedOn} ${game.plan.kickOff}  ${homeName} ${middle} ${awayName} ` +
        `at ${game.venue.name} (${game.fixture.status})`,
    );
  }
  console.log(`  results   ${confirmed}  confirmed, both from ${MATCH_DAY_ONE}`);
  console.log('');
  console.log(`  Sign in with ${FOUNDER.email} / ${FOUNDER.password}`);
  console.log(`  Or use this token, good until ${signedIn.expiresAt}:`);
  console.log(`    Authorization: Bearer ${signedIn.token}`);
  console.log(`  Point the service at it by setting DATABASE_FILE to ${file}, then npm run dev`);

  db.close();
}

try {
  seed(databaseFileFromEnv());
} catch (error) {
  // A refusal from the league is a mistake in this file, not a crash, so it is
  // worth reading rather than stack-tracing past.
  if (error instanceof AppError) {
    console.error(`The league refused the seed: ${error.message}`);
    console.error(`  ${error.code} ${JSON.stringify(error.details)}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
}

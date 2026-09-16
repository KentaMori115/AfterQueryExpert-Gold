/**
 * Stands a whole service up against its own in-memory database.
 *
 * Every test that needs a service calls this, so no two tests can see each
 * other's rows and the order they run in never matters. The founding secretary
 * is made directly against the service because there is nobody signed in yet to
 * make one over HTTP.
 */
import request from 'supertest';
import type { Express } from 'express';
import { buildApp } from '../src/app';
import { openDatabase, type Database } from '../src/db/client';
import { buildAuthModule } from '../src/modules/auth/auth.routes';
import type { Staff, StaffRole } from '../src/modules/auth/auth.types';

export const FOUNDER_PASSWORD = 'a-long-enough-secret';

export interface Floor {
  app: Express;
  db: Database;
  token: string;
  secretary: Staff;
}

export function floor(): Floor {
  const db = openDatabase(':memory:');
  const app = buildApp({ db });
  const auth = buildAuthModule(db);
  const secretary = auth.service.createStaff({
    email: 'secretary@touchline.example',
    fullName: 'Ada Fenwick',
    role: 'secretary',
    password: FOUNDER_PASSWORD,
  });
  const signedIn = auth.service.signIn(secretary.email, FOUNDER_PASSWORD);
  return { app, db, token: signedIn.token, secretary };
}

/** A request carrying a bearer token, the founding secretary's unless told otherwise. */
export function api(f: Floor, token: string = f.token) {
  const bearer = `Bearer ${token}`;
  return {
    get: (path: string) => request(f.app).get(path).set('Authorization', bearer),
    post: (path: string) => request(f.app).post(path).set('Authorization', bearer),
    patch: (path: string) => request(f.app).patch(path).set('Authorization', bearer),
    delete: (path: string) => request(f.app).delete(path).set('Authorization', bearer),
  };
}

/** A request carrying nothing, for the 401 half of an auth pair. */
export function bare(f: Floor) {
  return request(f.app);
}

/** Makes another staff member and signs them in, for the role tests. */
export function staffWith(f: Floor, role: StaffRole, email: string): string {
  const auth = buildAuthModule(f.db);
  const password = 'another-long-secret';
  auth.service.createStaff({ email, fullName: `A ${role}`, role, password });
  return auth.service.signIn(email, password).token;
}

/**
 * Builders for the rows most tests need before they can say anything
 * interesting. They go through HTTP rather than the services, so a fixture that
 * the API would refuse cannot quietly appear in a test.
 */
type Overrides = Record<string, unknown>;

export const SEASON_STARTS = '2031-08-09';
export const SEASON_ENDS = '2032-05-16';

export async function aSeason(f: Floor, overrides: Overrides = {}) {
  const res = await api(f)
    .post('/seasons')
    .send({
      name: 'Season 2031-32',
      startsOn: SEASON_STARTS,
      endsOn: SEASON_ENDS,
      registrationClosesOn: '2032-03-31',
      ...overrides,
    });
  return res.body;
}

export async function anOpenSeason(f: Floor, overrides: Overrides = {}) {
  const season = await aSeason(f, overrides);
  await api(f).post(`/seasons/${season.id}/open`).send({ openedOn: SEASON_STARTS });
  return (await api(f).get(`/seasons/${season.id}`)).body;
}

export async function aVenue(f: Floor, overrides: Overrides = {}) {
  const res = await api(f)
    .post('/venues')
    .send({
      name: 'Marsh Lane Recreation Ground',
      addressLine: '14 Marsh Lane, Ridgeway',
      postcode: 'RG4 7QP',
      surface: 'grass',
      pitchCount: 3,
      floodlit: false,
      ...overrides,
    });
  return res.body;
}

export async function aClub(f: Floor, overrides: Overrides = {}) {
  const res = await api(f)
    .post('/clubs')
    .send({
      name: 'Ridgeway Rovers',
      shortName: 'RID',
      foundedYear: 1974,
      contactEmail: 'secretary@ridgewayrovers.example',
      appliedOn: '2031-06-01',
      ...overrides,
    });
  return res.body;
}

export async function aMemberClub(f: Floor, overrides: Overrides = {}) {
  const club = await aClub(f, overrides);
  await api(f).post(`/clubs/${club.id}/admit`).send({ admittedOn: '2031-07-01' });
  return (await api(f).get(`/clubs/${club.id}`)).body;
}

/** A handful of member clubs, named apart so they can all be entered somewhere. */
export async function memberClubs(f: Floor, count: number) {
  const letters = ['RID', 'WIL', 'ASH', 'BRK', 'CAL', 'DEN', 'EAS', 'FEN', 'GRA', 'HAW'];
  const names = [
    'Ridgeway Rovers',
    'Willow Athletic',
    'Ashcroft Town',
    'Brookend United',
    'Calder Vale',
    'Denby Wanderers',
    'Eastfield Park',
    'Fenwick Albion',
    'Grangemoor',
    'Hawksley Road',
  ];
  const made = [];
  for (let i = 0; i < count; i += 1) {
    made.push(
      await aMemberClub(f, {
        name: names[i] ?? `Club ${i}`,
        shortName: letters[i] ?? `C${i}`,
        contactEmail: `club${i}@touchline.example`,
      }),
    );
  }
  return made;
}

export async function aDivision(f: Floor, seasonId: number, overrides: Overrides = {}) {
  const res = await api(f)
    .post(`/seasons/${seasonId}/divisions`)
    .send({
      name: 'Premier Division',
      tier: 1,
      teamCapacity: 10,
      promotionPlaces: 0,
      relegationPlaces: 2,
      ...overrides,
    });
  return res.body;
}

export async function aTeam(f: Floor, divisionId: number, clubId: number, rank = 'first') {
  const res = await api(f)
    .post(`/divisions/${divisionId}/teams`)
    .send({ clubId, rank, enteredOn: '2031-07-15' });
  return res.body;
}

/**
 * A season under way, a ground, and a division whose entries are fixed with
 * `teamCount` sides already in it. This is the state a fixture needs before it
 * can be scheduled at all, so nearly every test past this point starts here.
 */
export async function aFixedLeague(
  f: Floor,
  teamCount = 4,
  divisionOverrides: Overrides = {},
  venueOverrides: Overrides = {},
  seasonOverrides: Overrides = {},
) {
  const season = await anOpenSeason(f, seasonOverrides);
  const venue = await aVenue(f, venueOverrides);
  const division = await aDivision(f, season.id, {
    teamCapacity: Math.max(4, teamCount),
    relegationPlaces: 1,
    ...divisionOverrides,
  });
  const clubs = await memberClubs(f, teamCount);
  const teams = [];
  for (const club of clubs) teams.push(await aTeam(f, division.id, club.id));
  await api(f).post(`/divisions/${division.id}/fix`).send({ fixedOn: SEASON_STARTS });
  return { season, venue, division, clubs, teams };
}

/** Puts a game in the book between two of a fixed league's sides. */
export async function aFixture(
  f: Floor,
  divisionId: number,
  homeTeamId: number,
  awayTeamId: number,
  venueId: number,
  overrides: Overrides = {},
) {
  const res = await api(f)
    .post(`/divisions/${divisionId}/fixtures`)
    .send({
      homeTeamId,
      awayTeamId,
      venueId,
      playedOn: '2031-09-06',
      kickOff: '14:00',
      ...overrides,
    });
  return res.body;
}

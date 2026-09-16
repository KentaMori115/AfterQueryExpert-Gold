import {
  aDivision,
  aFixedLeague,
  aFixture,
  aVenue,
  api,
  bare,
  floor,
  staffWith,
  SEASON_STARTS,
  type Floor,
} from './helpers';

const END = '2032-05-16';

/** Fortnightly match days, so a run of games can be laid out in order. */
const DAYS = [
  '2031-09-06',
  '2031-09-20',
  '2031-10-04',
  '2031-10-18',
  '2031-11-01',
  '2031-11-15',
  '2031-12-06',
  '2032-01-10',
  '2032-02-07',
  '2032-03-06',
];

function pick<T>(list: readonly T[], index: number): T {
  const found = list[index];
  if (found === undefined) throw new Error(`nothing at ${index}`);
  return found;
}

/**
 * A fixed league with one side we follow, five opponents, and a player at the
 * followed side's club. Capacity six means four rounds, so the side can meet
 * each opponent up to four times, twice at home and twice away.
 */
async function aLeague(f: Floor) {
  const league = await aFixedLeague(f, 6, { teamCapacity: 6 });
  const side = pick(league.teams, 0);
  const others = league.teams.slice(1);
  const club = pick(league.clubs, 0);
  const player = (
    await api(f).post(`/clubs/${club.id}/players`).send({
      firstName: 'Owen',
      lastName: 'Tasker',
      bornOn: '2005-03-14',
      position: 'midfielder',
      squadNumber: 8,
      registeredOn: '2031-07-20',
    })
  ).body;
  return { ...league, side, others, club, player };
}
type League = Awaited<ReturnType<typeof aLeague>>;

/** Puts the followed side in a game on match day `index`, alternating home and away. */
async function gameOn(f: Floor, league: League, index: number) {
  const opponent = pick(league.others, index % league.others.length);
  const atHome = index % 2 === 0;
  return aFixture(
    f,
    league.division.id,
    atHome ? league.side.id : opponent.id,
    atHome ? opponent.id : league.side.id,
    league.venue.id,
    { playedOn: pick(DAYS, index) },
  );
}

/** The followed side's game on a named day against a named opponent. */
async function gameOnDay(f: Floor, league: League, day: string, opponent: number, atHome: boolean) {
  const other = pick(league.others, opponent);
  return aFixture(
    f,
    league.division.id,
    atHome ? league.side.id : other.id,
    atHome ? other.id : league.side.id,
    league.venue.id,
    { playedOn: day },
  );
}

/**
 * Two bookings for persistent fouling and then one for dissent: five points,
 * so the third card carries one accumulated match and nothing straight. The
 * cards fall on 6, 13 and 20 September.
 */
async function fivePoints(f: Floor, league: League) {
  const first = await gameOn(f, league, 0);
  await book(f, first.id, league.player.id, 'persistentFouling', DAYS[0] ?? '');
  const second = await gameOnDay(f, league, '2031-09-13', 3, false);
  await book(f, second.id, league.player.id, 'persistentFouling', '2031-09-13');
  const third = await gameOn(f, league, 1);
  const fifth = await book(f, third.id, league.player.id, 'dissent', DAYS[1] ?? '');
  expect(fifth.accumulationBan).toBe(1);
  return fifth;
}

/** Reports a score by the home side and has the away side confirm it, so the game is played. */
async function play(f: Floor, fixture: Record<string, any>, homeGoals = 1, awayGoals = 0) {
  const reported = await api(f).post(`/fixtures/${fixture.id}/result`).send({
    homeGoals,
    awayGoals,
    reportedByTeamId: fixture.homeTeamId,
    reportedOn: fixture.playedOn,
  });
  expect(reported.status).toBe(201);
  const confirmed = await api(f).post(`/results/${reported.body.id}/confirm`).send({
    confirmedByTeamId: fixture.awayTeamId,
    confirmedOn: fixture.playedOn,
  });
  expect(confirmed.status).toBe(200);
}

async function book(
  f: Floor,
  fixtureId: number,
  playerId: number,
  offence: string,
  shownOn: string,
) {
  const res = await api(f)
    .post(`/fixtures/${fixtureId}/cards`)
    .send({ playerId, offence, shownOn });
  expect(res.status).toBe(201);
  return res.body;
}

async function ledger(f: Floor, playerId: number, asOf = END) {
  return api(f).get(`/players/${playerId}/suspensions?asOf=${asOf}`);
}

/**
 * A second division a tier down, holding a reserve side for each of the four
 * clubs, with its own ground so nothing collides with the first division.
 */
async function aReserveDivision(f: Floor, league: League) {
  const venue = await aVenue(f, {
    name: 'Copse Lane Playing Fields',
    postcode: 'RG5 2LP',
  });
  const division = await aDivision(f, league.season.id, {
    name: 'Reserve Division',
    tier: 2,
    teamCapacity: 6,
    promotionPlaces: 0,
    relegationPlaces: 1,
  });
  const teams = [];
  for (const club of league.clubs) {
    const res = await api(f)
      .post(`/divisions/${division.id}/teams`)
      .send({ clubId: club.id, rank: 'reserves', enteredOn: '2031-07-15' });
    expect(res.status).toBe(201);
    teams.push(res.body);
  }
  const fixed = await api(f).post(`/divisions/${division.id}/fix`).send({ fixedOn: SEASON_STARTS });
  expect(fixed.status).toBe(200);
  return {
    venue,
    division,
    teams,
    reserves: pick(teams, 0),
    otherReserves: teams.slice(1),
  };
}

async function reserveGameOn(
  f: Floor,
  reserve: Awaited<ReturnType<typeof aReserveDivision>>,
  index: number,
) {
  const opponent = pick(reserve.otherReserves, index % reserve.otherReserves.length);
  const atHome = index % 2 === 0;
  return aFixture(
    f,
    reserve.division.id,
    atHome ? reserve.reserves.id : opponent.id,
    atHome ? opponent.id : reserve.reserves.id,
    reserve.venue.id,
    { playedOn: pick(DAYS, index) },
  );
}

describe('reading a serving ledger', () => {
  it('needs a bearer token', async () => {
    const f = floor();
    const league = await aLeague(f);
    const res = await bare(f).get(`/players/${league.player.id}/suspensions?asOf=${END}`);
    expect(res.status).toBe(401);
  });

  it('answers every field of an untouched ledger by value', async () => {
    const f = floor();
    const league = await aLeague(f);
    const res = await ledger(f, league.player.id);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'asOf',
      'entries',
      'matchesBanned',
      'matchesOutstanding',
      'matchesServed',
      'playerId',
      'suspended',
    ]);
    expect(res.body.playerId).toBe(league.player.id);
    expect(res.body.asOf).toBe(END);
    expect(res.body.matchesBanned).toBe(0);
    expect(res.body.matchesServed).toBe(0);
    expect(res.body.matchesOutstanding).toBe(0);
    expect(res.body.suspended).toBe(false);
    expect(res.body.entries).toEqual([]);
  });

  it('is a 404 for a player the league has never had, and a reading for one it has', async () => {
    const f = floor();
    const league = await aLeague(f);
    const missing = await ledger(f, 9999);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('not_found');
    const found = await ledger(f, league.player.id);
    expect(found.status).toBe(200);
    expect(found.body.playerId).toBe(league.player.id);
  });

  it('insists on asOf', async () => {
    const f = floor();
    const league = await aLeague(f);
    const res = await api(f).get(`/players/${league.player.id}/suspensions`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('refuses a misspelled day', async () => {
    const f = floor();
    const league = await aLeague(f);
    const res = await ledger(f, league.player.id, '2032-5-1');
    expect(res.status).toBe(400);
  });

  it('refuses a day the calendar does not have', async () => {
    const f = floor();
    const league = await aLeague(f);
    const res = await ledger(f, league.player.id, '2032-02-30');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('refuses a query field it does not take', async () => {
    const f = floor();
    const league = await aLeague(f);
    const res = await api(f).get(`/players/${league.player.id}/suspensions?asOf=${END}&teamId=1`);
    expect(res.status).toBe(400);
  });

  it('lets a readonly colleague read it', async () => {
    const f = floor();
    const league = await aLeague(f);
    const token = staffWith(f, 'readonly', 'reader@touchline.example');
    const res = await api(f, token).get(`/players/${league.player.id}/suspensions?asOf=${END}`);
    expect(res.status).toBe(200);
    expect(res.body.playerId).toBe(league.player.id);
  });
});

describe('what a card is worth in matches', () => {
  it('gives a booking that cost only a fine no entry at all', async () => {
    const f = floor();
    const league = await aLeague(f);
    const game = await gameOn(f, league, 0);
    await book(f, game.id, league.player.id, 'dissent', DAYS[0] ?? '');
    const res = await ledger(f, league.player.id);
    expect(res.body.entries).toEqual([]);
    expect(res.body.matchesBanned).toBe(0);
    expect(res.body.suspended).toBe(false);
  });

  it('opens an entry for a straight red with every field', async () => {
    const f = floor();
    const league = await aLeague(f);
    const game = await gameOn(f, league, 0);
    const card = await book(
      f,
      game.id,
      league.player.id,
      'denyingGoalscoringOpportunity',
      DAYS[0] ?? '',
    );
    const res = await ledger(f, league.player.id);
    expect(res.body.entries).toHaveLength(1);
    const entry = res.body.entries[0];
    expect(Object.keys(entry).sort()).toEqual([
      'cardId',
      'clearedOn',
      'fixtureId',
      'matches',
      'outstanding',
      'served',
      'servedIn',
      'shownOn',
      'teamId',
    ]);
    expect(entry.cardId).toBe(card.id);
    expect(entry.fixtureId).toBe(game.id);
    expect(entry.teamId).toBe(league.side.id);
    expect(entry.shownOn).toBe(DAYS[0]);
    expect(entry.matches).toBe(1);
    expect(entry.served).toBe(0);
    expect(entry.outstanding).toBe(1);
    expect(entry.servedIn).toEqual([]);
    expect(entry.clearedOn).toBe(null);
    expect(res.body.matchesBanned).toBe(1);
    expect(res.body.matchesServed).toBe(0);
    expect(res.body.matchesOutstanding).toBe(1);
    expect(res.body.suspended).toBe(true);
  });

  it('gives the booking that reaches five points a match of its own', async () => {
    const f = floor();
    const league = await aLeague(f);
    const cards = [];
    for (const [index, offence] of [
      'persistentFouling',
      'persistentFouling',
      'dissent',
    ].entries()) {
      const game = await gameOn(f, league, index);
      cards.push(await book(f, game.id, league.player.id, offence, DAYS[index] ?? ''));
    }
    const res = await ledger(f, league.player.id);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].cardId).toBe(pick(cards, 2).id);
    expect(res.body.entries[0].matches).toBe(1);
    expect(res.body.matchesBanned).toBe(1);
  });

  it('values a red that also crosses a threshold at the longer ban, not the sum', async () => {
    const f = floor();
    const league = await aLeague(f);
    for (const index of [0, 1]) {
      const game = await gameOn(f, league, index);
      await book(f, game.id, league.player.id, 'persistentFouling', DAYS[index] ?? '');
    }
    const game = await gameOn(f, league, 2);
    // Six points on four crosses both five and ten: two matches accumulated,
    // three straight. Served together, so three.
    await book(f, game.id, league.player.id, 'violentConduct', DAYS[2] ?? '');
    const res = await ledger(f, league.player.id);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].matches).toBe(3);
    expect(res.body.matchesBanned).toBe(3);
    expect(res.body.matchesOutstanding).toBe(3);
  });
});

describe('which games serve a ban', () => {
  it('never counts the game the card was shown in, even once it is played', async () => {
    const f = floor();
    const league = await aLeague(f);
    const game = await gameOn(f, league, 0);
    await book(f, game.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');
    await play(f, game);
    const res = await ledger(f, league.player.id);
    expect(res.body.entries[0].served).toBe(0);
    expect(res.body.entries[0].outstanding).toBe(1);
    expect(res.body.suspended).toBe(true);
  });

  it('serves one match with the next game the side plays', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');
    const second = await gameOn(f, league, 1);
    await play(f, second);
    const res = await ledger(f, league.player.id);
    const entry = res.body.entries[0];
    expect(entry.served).toBe(1);
    expect(entry.outstanding).toBe(0);
    expect(entry.servedIn).toEqual([second.id]);
    expect(entry.clearedOn).toBe(DAYS[1]);
    expect(res.body.matchesServed).toBe(1);
    expect(res.body.matchesOutstanding).toBe(0);
    expect(res.body.suspended).toBe(false);
  });

  it('leaves a walkover out of the serving while the table still takes it', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');
    const second = await gameOn(f, league, 1);
    const awarded = await api(f).post(`/fixtures/${second.id}/award`).send({
      awardedOn: DAYS[1],
      awardedToTeamId: league.side.id,
      reason: 'noShow',
    });
    expect(awarded.status).toBe(200);

    const table = await api(f).get(`/divisions/${league.division.id}/table?asOf=${END}`);
    expect(table.body.played).toBe(1);

    const res = await ledger(f, league.player.id);
    expect(res.body.entries[0].served).toBe(0);
    expect(res.body.entries[0].servedIn).toEqual([]);
    expect(res.body.suspended).toBe(true);
  });

  it('serves nothing with a game that was called off', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');
    const second = await gameOn(f, league, 1);
    await api(f).post(`/fixtures/${second.id}/postpone`).send({ postponedOn: DAYS[1] });
    const res = await ledger(f, league.player.id);
    expect(res.body.entries[0].served).toBe(0);
    expect(res.body.matchesOutstanding).toBe(1);
  });

  it('serves with a called-off game on the day it is finally played', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');
    const second = await gameOn(f, league, 1);
    await api(f).post(`/fixtures/${second.id}/postpone`).send({ postponedOn: DAYS[1] });
    const moved = await api(f)
      .post(`/fixtures/${second.id}/reschedule`)
      .send({ playedOn: DAYS[3], kickOff: '14:00' });
    expect(moved.status).toBe(200);
    await play(f, moved.body);

    const res = await ledger(f, league.player.id);
    const entry = res.body.entries[0];
    expect(entry.served).toBe(1);
    expect(entry.servedIn).toEqual([second.id]);
    expect(entry.clearedOn).toBe(DAYS[3]);
  });

  it('gets nothing from a game the referee abandoned', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');
    const second = await gameOn(f, league, 1);
    const res = await api(f).post(`/fixtures/${second.id}/abandon`).send({ abandonedOn: DAYS[1] });
    expect(res.status).toBe(200);
    const read = await ledger(f, league.player.id);
    expect(read.body.entries[0].served).toBe(0);
    expect(read.body.suspended).toBe(true);
  });

  it('does not count a score that has only been reported', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');
    const second = await gameOn(f, league, 1);
    const reported = await api(f).post(`/fixtures/${second.id}/result`).send({
      homeGoals: 2,
      awayGoals: 2,
      reportedByTeamId: second.homeTeamId,
      reportedOn: DAYS[1],
    });
    expect(reported.status).toBe(201);
    const res = await ledger(f, league.player.id);
    expect(res.body.entries[0].served).toBe(0);
  });

  it('counts a disputed score once the league has settled it', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');
    const second = await gameOn(f, league, 1);
    const reported = await api(f).post(`/fixtures/${second.id}/result`).send({
      homeGoals: 2,
      awayGoals: 2,
      reportedByTeamId: second.homeTeamId,
      reportedOn: DAYS[1],
    });
    await api(f).post(`/results/${reported.body.id}/dispute`).send({
      disputedByTeamId: second.awayTeamId,
      disputedOn: DAYS[1],
      note: 'It finished three two',
    });
    const before = await ledger(f, league.player.id);
    expect(before.body.entries[0].served).toBe(0);

    const settled = await api(f)
      .post(`/results/${reported.body.id}/settle`)
      .send({ settledOn: DAYS[2], homeGoals: 3, awayGoals: 2 });
    expect(settled.status).toBe(200);
    const after = await ledger(f, league.player.id);
    expect(after.body.entries[0].served).toBe(1);
    expect(after.body.entries[0].servedIn).toEqual([second.id]);
    expect(after.body.entries[0].clearedOn).toBe(DAYS[1]);
  });

  it('discharges only over the team named on the card, never over a sibling team', async () => {
    const f = floor();
    const league = await aLeague(f);
    const reserve = await aReserveDivision(f, league);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');

    const reservesGame = await reserveGameOn(f, reserve, 1);
    await play(f, reservesGame);
    const unmoved = await ledger(f, league.player.id);
    expect(unmoved.body.entries[0].served).toBe(0);
    expect(unmoved.body.suspended).toBe(true);

    const firstTeamGame = await gameOn(f, league, 2);
    await play(f, firstTeamGame);
    const served = await ledger(f, league.player.id);
    expect(served.body.entries[0].servedIn).toEqual([firstTeamGame.id]);
    expect(served.body.suspended).toBe(false);
  });

  it('serves a card shown for the reserves with reserve games', async () => {
    const f = floor();
    const league = await aLeague(f);
    const reserve = await aReserveDivision(f, league);
    const reservesGame = await reserveGameOn(f, reserve, 0);
    await book(f, reservesGame.id, league.player.id, 'seriousFoulPlay', DAYS[0] ?? '');

    const firstTeamGame = await gameOn(f, league, 1);
    await play(f, firstTeamGame);
    const nextReserves = await reserveGameOn(f, reserve, 2);
    await play(f, nextReserves);

    const res = await ledger(f, league.player.id);
    const entry = res.body.entries[0];
    expect(entry.teamId).toBe(reserve.reserves.id);
    expect(entry.matches).toBe(2);
    expect(entry.served).toBe(1);
    expect(entry.servedIn).toEqual([nextReserves.id]);
    expect(entry.outstanding).toBe(1);
    expect(entry.clearedOn).toBe(null);
    expect(res.body.suspended).toBe(true);
  });

  it('keeps serving with the old side after the player has transferred', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');
    const moved = await api(f)
      .post(`/players/${league.player.id}/transfer`)
      .send({
        clubId: pick(league.clubs, 2).id,
        transferredOn: '2031-09-10',
        squadNumber: 9,
      });
    expect(moved.status).toBe(200);

    const second = await gameOn(f, league, 1);
    await play(f, second);
    const res = await ledger(f, league.player.id);
    const entry = res.body.entries[0];
    expect(entry.teamId).toBe(league.side.id);
    expect(entry.served).toBe(1);
    expect(entry.servedIn).toEqual([second.id]);
    expect(res.body.suspended).toBe(false);
  });
});

describe('the order bans are served in', () => {
  it('queues cards oldest first and gives each game to the earliest one outstanding', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    const older = await book(f, first.id, league.player.id, 'seriousFoulPlay', DAYS[0] ?? '');
    const second = await gameOn(f, league, 1);
    await play(f, second);
    const newer = await book(
      f,
      second.id,
      league.player.id,
      'denyingGoalscoringOpportunity',
      DAYS[1] ?? '',
    );
    const games = [];
    for (const index of [2, 3, 4]) {
      const game = await gameOn(f, league, index);
      await play(f, game);
      games.push(game);
    }

    const res = await ledger(f, league.player.id);
    expect(res.body.entries.map((entry: { cardId: number }) => entry.cardId)).toEqual([
      older.id,
      newer.id,
    ]);
    const [a, b] = res.body.entries;
    expect(a.matches).toBe(2);
    expect(a.servedIn).toEqual([second.id, pick(games, 0).id]);
    expect(a.clearedOn).toBe(DAYS[2]);
    expect(b.matches).toBe(1);
    expect(b.servedIn).toEqual([pick(games, 1).id]);
    expect(b.clearedOn).toBe(DAYS[3]);
    expect(res.body.matchesBanned).toBe(3);
    expect(res.body.matchesServed).toBe(3);
    expect(res.body.matchesOutstanding).toBe(0);
  });

  it('lets a later card start only once the earlier one is clear', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'seriousFoulPlay', DAYS[0] ?? '');
    const second = await gameOn(f, league, 1);
    await play(f, second);
    await book(f, second.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[1] ?? '');
    const third = await gameOn(f, league, 2);
    await play(f, third);

    const res = await ledger(f, league.player.id);
    const [a, b] = res.body.entries;
    expect(a.outstanding).toBe(0);
    expect(b.served).toBe(0);
    expect(b.outstanding).toBe(1);
    expect(res.body.suspended).toBe(true);
  });

  it('drops a rescinded card and lets its games fall through to the next', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    const older = await book(f, first.id, league.player.id, 'seriousFoulPlay', DAYS[0] ?? '');
    const second = await gameOn(f, league, 1);
    await play(f, second);
    const newer = await book(
      f,
      second.id,
      league.player.id,
      'denyingGoalscoringOpportunity',
      DAYS[1] ?? '',
    );
    const third = await gameOn(f, league, 2);
    await play(f, third);
    const fourth = await gameOn(f, league, 3);
    await play(f, fourth);

    const before = await ledger(f, league.player.id);
    expect(before.body.entries[0].servedIn).toEqual([second.id, third.id]);
    expect(before.body.entries[1].servedIn).toEqual([fourth.id]);

    const rescinded = await api(f)
      .post(`/cards/${older.id}/rescind`)
      .send({ rescindedOn: DAYS[3] });
    expect(rescinded.status).toBe(200);

    const after = await ledger(f, league.player.id);
    expect(after.body.entries).toHaveLength(1);
    expect(after.body.entries[0].cardId).toBe(newer.id);
    expect(after.body.entries[0].servedIn).toEqual([third.id]);
    expect(after.body.entries[0].clearedOn).toBe(DAYS[2]);
    expect(after.body.matchesBanned).toBe(1);
    expect(after.body.suspended).toBe(false);
  });

  it('leaves out games played after asOf', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');
    const second = await gameOn(f, league, 1);
    await play(f, second);

    const early = await ledger(f, league.player.id, '2031-09-19');
    expect(early.body.entries[0].served).toBe(0);
    expect(early.body.suspended).toBe(true);

    const onTheDay = await ledger(f, league.player.id, DAYS[1] ?? '');
    expect(onTheDay.body.entries[0].served).toBe(1);
    expect(onTheDay.body.suspended).toBe(false);
  });

  it('leaves out cards shown after asOf', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    const older = await book(
      f,
      first.id,
      league.player.id,
      'denyingGoalscoringOpportunity',
      DAYS[0] ?? '',
    );
    const third = await gameOn(f, league, 2);
    await book(f, third.id, league.player.id, 'violentConduct', DAYS[2] ?? '');

    const res = await ledger(f, league.player.id, DAYS[1] ?? '');
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].cardId).toBe(older.id);
    expect(res.body.matchesBanned).toBe(1);

    const whole = await ledger(f, league.player.id);
    expect(whole.body.entries).toHaveLength(2);
    expect(whole.body.matchesBanned).toBe(4);
  });
});

describe('when a ban starts', () => {
  it('lets no game inside the fortnight serve an accumulated ban', async () => {
    const f = floor();
    const league = await aLeague(f);
    await fivePoints(f, league);
    const week = await gameOnDay(f, league, '2031-09-27', 4, true);
    await play(f, week);
    const thirteenth = await gameOnDay(f, league, '2031-10-03', 2, false);
    await play(f, thirteenth);

    const res = await ledger(f, league.player.id, '2031-10-03');
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].served).toBe(0);
    expect(res.body.entries[0].servedIn).toEqual([]);
    expect(res.body.matchesOutstanding).toBe(1);
    expect(res.body.suspended).toBe(true);
  });

  it('serves it with a game on the fourteenth day itself', async () => {
    const f = floor();
    const league = await aLeague(f);
    const fifth = await fivePoints(f, league);
    const week = await gameOnDay(f, league, '2031-09-27', 4, true);
    await play(f, week);
    const fortnight = await gameOn(f, league, 2);
    expect(fortnight.playedOn).toBe('2031-10-04');
    await play(f, fortnight);

    const res = await ledger(f, league.player.id);
    const entry = res.body.entries[0];
    expect(entry.cardId).toBe(fifth.id);
    expect(entry.servedIn).toEqual([fortnight.id]);
    expect(entry.clearedOn).toBe('2031-10-04');
    expect(res.body.suspended).toBe(false);
  });

  it('serves a straight match at once and waits for the accumulated rest', async () => {
    const f = floor();
    const league = await aLeague(f);
    const booked = [
      await gameOn(f, league, 0),
      await gameOnDay(f, league, '2031-09-13', 3, false),
      await gameOn(f, league, 1),
      await gameOnDay(f, league, '2031-09-27', 2, false),
    ];
    for (const game of booked) {
      const day: string = game.playedOn;
      await book(f, game.id, league.player.id, 'persistentFouling', day);
    }
    // Eight points, then a red worth three: eleven crosses ten, so the card
    // carries two accumulated matches against one straight. Two matches, the
    // second of which cannot be served before 18 October.
    const sentOff = await gameOn(f, league, 2);
    const red = await book(
      f,
      sentOff.id,
      league.player.id,
      'denyingGoalscoringOpportunity',
      DAYS[2] ?? '',
    );
    expect(red.straightBan).toBe(1);
    expect(red.accumulationBan).toBe(2);

    const first = await gameOnDay(f, league, '2031-10-11', 4, true);
    await play(f, first);
    const second = await gameOnDay(f, league, '2031-10-12', 1, true);
    await play(f, second);
    const eleventh = await gameOnDay(f, league, '2031-10-15', 0, false);
    await play(f, eleventh);

    const waiting = await ledger(f, league.player.id, '2031-10-15');
    const owed = waiting.body.entries.find((entry: { cardId: number }) => entry.cardId === red.id);
    expect(owed.served).toBe(1);
    expect(owed.outstanding).toBe(1);
    expect(owed.servedIn).toEqual([second.id]);
    expect(owed.clearedOn).toBe(null);

    const fourteenth = await gameOn(f, league, 3);
    expect(fourteenth.playedOn).toBe('2031-10-18');
    await play(f, fourteenth);
    const done = await ledger(f, league.player.id);
    const cleared = done.body.entries.find((entry: { cardId: number }) => entry.cardId === red.id);
    expect(cleared.servedIn).toEqual([second.id, fourteenth.id]);
    expect(cleared.clearedOn).toBe('2031-10-18');
    expect(done.body.matchesOutstanding).toBe(0);
  });

  it('hands a game to the oldest card that is ready, skipping one still inside its wait', async () => {
    const f = floor();
    const league = await aLeague(f);
    const fifth = await fivePoints(f, league);
    const week = await gameOnDay(f, league, '2031-09-27', 4, true);
    const red = await book(
      f,
      week.id,
      league.player.id,
      'denyingGoalscoringOpportunity',
      '2031-09-27',
    );
    expect(red.accumulationBan).toBe(0);
    expect(red.straightBan).toBe(1);

    const early = await gameOnDay(f, league, '2031-10-01', 2, false);
    await play(f, early);
    const fortnight = await gameOn(f, league, 2);
    await play(f, fortnight);

    const res = await ledger(f, league.player.id);
    expect(res.body.entries.map((entry: { cardId: number }) => entry.cardId)).toEqual([
      fifth.id,
      red.id,
    ]);
    expect(res.body.entries[0].servedIn).toEqual([fortnight.id]);
    expect(res.body.entries[1].servedIn).toEqual([early.id]);
    expect(res.body.entries[1].clearedOn).toBe('2031-10-01');
    expect(res.body.matchesOutstanding).toBe(0);
  });
});

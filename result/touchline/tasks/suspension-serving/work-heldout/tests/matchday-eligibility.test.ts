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

const DAYS = [
  '2031-09-06',
  '2031-09-20',
  '2031-10-04',
  '2031-10-18',
  '2031-11-01',
  '2031-11-15',
  '2031-12-06',
  '2032-01-10',
];

function pick<T>(list: readonly T[], index: number): T {
  const found = list[index];
  if (found === undefined) throw new Error(`nothing at ${index}`);
  return found;
}

async function registerAt(f: Floor, clubId: number, lastName: string, squadNumber: number) {
  const res = await api(f).post(`/clubs/${clubId}/players`).send({
    firstName: 'Sam',
    lastName,
    bornOn: '2004-11-02',
    position: 'defender',
    squadNumber,
    registeredOn: '2031-07-20',
  });
  expect(res.status).toBe(201);
  return res.body;
}

/** A fixed league, the side we follow, and one player at its club. */
async function aLeague(f: Floor) {
  const league = await aFixedLeague(f, 4, { teamCapacity: 6 });
  const side = pick(league.teams, 0);
  const others = league.teams.slice(1);
  const club = pick(league.clubs, 0);
  const player = await registerAt(f, club.id, 'Tasker', 8);
  return { ...league, side, others, club, player };
}
type League = Awaited<ReturnType<typeof aLeague>>;

/** The followed side's game on match day `index`: even indexes at home, odd away. */
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

async function play(f: Floor, fixture: Record<string, any>) {
  const reported = await api(f).post(`/fixtures/${fixture.id}/result`).send({
    homeGoals: 2,
    awayGoals: 1,
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

/** Five booking points over 6, 13 and 20 September: one accumulated match, nothing straight. */
async function fivePoints(f: Floor, league: League) {
  const first = await gameOn(f, league, 0);
  await book(f, first.id, league.player.id, 'persistentFouling', DAYS[0] ?? '');
  const second = await gameOnDay(f, league, '2031-09-13', 2, false);
  await book(f, second.id, league.player.id, 'persistentFouling', '2031-09-13');
  const third = await gameOn(f, league, 1);
  const fifth = await book(f, third.id, league.player.id, 'dissent', DAYS[1] ?? '');
  expect(fifth.accumulationBan).toBe(1);
  return fifth;
}

async function eligibility(f: Floor, fixtureId: number) {
  return api(f).get(`/fixtures/${fixtureId}/eligibility`);
}

async function record(f: Floor, playerId: number, asOf = END) {
  return api(f).get(`/players/${playerId}/record?asOf=${asOf}`);
}

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
  await api(f).post(`/divisions/${division.id}/fix`).send({ fixedOn: SEASON_STARTS });
  return {
    venue,
    division,
    reserves: pick(teams, 0),
    otherReserves: teams.slice(1),
  };
}

describe('reading who may not play', () => {
  it('needs a bearer token', async () => {
    const f = floor();
    const league = await aLeague(f);
    const game = await gameOn(f, league, 0);
    const res = await bare(f).get(`/fixtures/${game.id}/eligibility`);
    expect(res.status).toBe(401);
  });

  it('is a 404 for a game that is not in the book, and a reading for one that is', async () => {
    const f = floor();
    const league = await aLeague(f);
    const missing = await eligibility(f, 9999);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('not_found');
    const game = await gameOn(f, league, 0);
    const found = await eligibility(f, game.id);
    expect(found.status).toBe(200);
    expect(found.body.fixtureId).toBe(game.id);
  });

  it('takes no query at all', async () => {
    const f = floor();
    const league = await aLeague(f);
    const game = await gameOn(f, league, 0);
    const res = await api(f).get(`/fixtures/${game.id}/eligibility?asOf=${END}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('lets a readonly colleague read it', async () => {
    const f = floor();
    const league = await aLeague(f);
    const game = await gameOn(f, league, 0);
    const token = staffWith(f, 'readonly', 'reader@touchline.example');
    const res = await api(f, token).get(`/fixtures/${game.id}/eligibility`);
    expect(res.status).toBe(200);
  });

  it('answers the shape, read on the day before the game', async () => {
    const f = floor();
    const league = await aLeague(f);
    const game = await gameOn(f, league, 0);
    const res = await eligibility(f, game.id);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['asOf', 'fixtureId', 'ineligible', 'playedOn']);
    expect(res.body.fixtureId).toBe(game.id);
    expect(res.body.playedOn).toBe(DAYS[0]);
    expect(res.body.asOf).toBe('2031-09-05');
    expect(res.body.ineligible).toEqual([]);
  });

  it('lists a player with a match outstanding, with every field', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');
    const second = await gameOn(f, league, 1);
    const res = await eligibility(f, second.id);
    expect(res.body.ineligible).toHaveLength(1);
    const line = res.body.ineligible[0];
    expect(Object.keys(line).sort()).toEqual(['clubId', 'outstanding', 'playerId', 'teamId']);
    expect(line.playerId).toBe(league.player.id);
    expect(line.clubId).toBe(league.club.id);
    expect(line.teamId).toBe(league.side.id);
    expect(line.outstanding).toBe(1);
  });

  it('lists nobody for the game the card was shown in', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'violentConduct', DAYS[0] ?? '');
    const res = await eligibility(f, first.id);
    expect(res.body.ineligible).toEqual([]);
  });

  it('clears the player once the ban has been served', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');
    const second = await gameOn(f, league, 1);
    await play(f, second);
    const third = await gameOn(f, league, 2);
    const res = await eligibility(f, third.id);
    expect(res.body.ineligible).toEqual([]);
  });

  it('reports what is left to serve, not what was banned', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'seriousFoulPlay', DAYS[0] ?? '');
    const second = await gameOn(f, league, 1);
    await play(f, second);
    const third = await gameOn(f, league, 2);
    const res = await eligibility(f, third.id);
    expect(res.body.ineligible).toHaveLength(1);
    expect(res.body.ineligible[0].outstanding).toBe(1);
  });

  it('leaves the player barred when the game in between was awarded', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');
    const second = await gameOn(f, league, 1);
    await api(f).post(`/fixtures/${second.id}/award`).send({
      awardedOn: DAYS[1],
      awardedToTeamId: second.homeTeamId,
      reason: 'groundUnfit',
    });
    const third = await gameOn(f, league, 2);
    const res = await eligibility(f, third.id);
    expect(res.body.ineligible).toHaveLength(1);
    expect(res.body.ineligible[0].outstanding).toBe(1);
  });

  it('lists home before away, and each side in id order', async () => {
    const f = floor();
    const league = await aLeague(f);
    const second = await registerAt(f, league.club.id, 'Underwood', 9);
    const awayClub = pick(league.clubs, 1);
    const visitor = await registerAt(f, awayClub.id, 'Vance', 4);

    // Match day 0 is the followed side at home to the first opponent, so all
    // three can be sent off in the one game.
    const first = await gameOn(f, league, 0);
    await book(f, first.id, second.id, 'seriousFoulPlay', DAYS[0] ?? '');
    await book(f, first.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');
    await book(f, first.id, visitor.id, 'violentConduct', DAYS[0] ?? '');

    // Match day 3 is the return game: the first opponent at home, the followed side away.
    const back = await gameOn(f, league, 3);
    expect(back.homeTeamId).toBe(pick(league.others, 0).id);
    const res = await eligibility(f, back.id);
    expect(
      res.body.ineligible.map((line: { playerId: number; teamId: number }) => [
        line.playerId,
        line.teamId,
      ]),
    ).toEqual([
      [visitor.id, pick(league.others, 0).id],
      [league.player.id, league.side.id],
      [second.id, league.side.id],
    ]);
  });

  it('bars a transferred player at the new club and no longer at the old one', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');
    const newClub = pick(league.clubs, 1);
    const moved = await api(f).post(`/players/${league.player.id}/transfer`).send({
      clubId: newClub.id,
      transferredOn: '2031-09-10',
      squadNumber: 9,
    });
    expect(moved.status).toBe(200);

    // The return game has both clubs in it: the new club at home, the old side away.
    const back = await gameOn(f, league, 3);
    const res = await eligibility(f, back.id);
    expect(res.body.ineligible).toHaveLength(1);
    expect(res.body.ineligible[0].playerId).toBe(league.player.id);
    expect(res.body.ineligible[0].clubId).toBe(newClub.id);
    expect(res.body.ineligible[0].teamId).toBe(pick(league.others, 0).id);
  });

  it('is cleared by a game of the old side after a transfer', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');
    const newClub = pick(league.clubs, 1);
    await api(f).post(`/players/${league.player.id}/transfer`).send({
      clubId: newClub.id,
      transferredOn: '2031-09-10',
      squadNumber: 9,
    });

    const second = await gameOn(f, league, 1);
    await play(f, second);
    const back = await gameOn(f, league, 3);
    const res = await eligibility(f, back.id);
    expect(res.body.ineligible).toEqual([]);
  });

  it('keeps a player out of every team at the club though a single team discharges', async () => {
    const f = floor();
    const league = await aLeague(f);
    const reserve = await aReserveDivision(f, league);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');

    const reservesGame = await aFixture(
      f,
      reserve.division.id,
      reserve.reserves.id,
      pick(reserve.otherReserves, 0).id,
      reserve.venue.id,
      { playedOn: DAYS[1] },
    );
    const barred = await eligibility(f, reservesGame.id);
    expect(barred.body.ineligible).toHaveLength(1);
    expect(barred.body.ineligible[0].teamId).toBe(reserve.reserves.id);
    expect(barred.body.ineligible[0].clubId).toBe(league.club.id);

    await play(f, reservesGame);
    const third = await gameOn(f, league, 2);
    const still = await eligibility(f, third.id);
    expect(still.body.ineligible).toHaveLength(1);
    expect(still.body.ineligible[0].outstanding).toBe(1);
  });

  it('does not list a player the club has released', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');
    const released = await api(f)
      .post(`/players/${league.player.id}/release`)
      .send({ releasedOn: '2031-09-10' });
    expect(released.status).toBe(200);
    const second = await gameOn(f, league, 1);
    const res = await eligibility(f, second.id);
    expect(res.body.ineligible).toEqual([]);
  });

  it('frees the player when the card is rescinded', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    const card = await book(
      f,
      first.id,
      league.player.id,
      'denyingGoalscoringOpportunity',
      DAYS[0] ?? '',
    );
    const second = await gameOn(f, league, 1);
    const before = await eligibility(f, second.id);
    expect(before.body.ineligible).toHaveLength(1);

    await api(f).post(`/cards/${card.id}/rescind`).send({ rescindedOn: '2031-09-10' });
    const after = await eligibility(f, second.id);
    expect(after.body.ineligible).toEqual([]);
  });

  it('reads the day before the day a called-off game is finally played', async () => {
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

    const third = await gameOn(f, league, 2);
    await play(f, third);

    const res = await eligibility(f, second.id);
    expect(res.body.playedOn).toBe(DAYS[3]);
    expect(res.body.asOf).toBe('2031-10-17');
    expect(res.body.ineligible).toEqual([]);
  });
});

describe('a ban that is still waiting', () => {
  it('bars nobody inside the fortnight, though the ledger already owes the match', async () => {
    const f = floor();
    const league = await aLeague(f);
    await fivePoints(f, league);
    const week = await gameOnDay(f, league, '2031-09-27', 2, true);
    const res = await eligibility(f, week.id);
    expect(res.body.ineligible).toEqual([]);

    const ledger = await api(f).get(`/players/${league.player.id}/suspensions?asOf=2031-09-26`);
    expect(ledger.body.matchesOutstanding).toBe(1);
    expect(ledger.body.suspended).toBe(true);
  });

  it('bars the player from the game on the fourteenth day', async () => {
    const f = floor();
    const league = await aLeague(f);
    await fivePoints(f, league);
    const week = await gameOnDay(f, league, '2031-09-27', 2, true);
    await play(f, week);
    const fortnight = await gameOn(f, league, 2);
    expect(fortnight.playedOn).toBe('2031-10-04');
    const res = await eligibility(f, fortnight.id);
    expect(res.body.ineligible).toHaveLength(1);
    expect(res.body.ineligible[0].playerId).toBe(league.player.id);
    expect(res.body.ineligible[0].outstanding).toBe(1);
  });

  it('bars, frees and bars again as the two parts of a red fall due', async () => {
    const f = floor();
    const league = await aLeague(f);
    const booked = [
      await gameOn(f, league, 0),
      await gameOnDay(f, league, '2031-09-13', 2, false),
      await gameOn(f, league, 1),
      await gameOnDay(f, league, '2031-09-27', 2, false),
    ];
    for (const game of booked) {
      const day: string = game.playedOn;
      await book(f, game.id, league.player.id, 'persistentFouling', day);
    }
    const sentOff = await gameOn(f, league, 2);
    const red = await book(
      f,
      sentOff.id,
      league.player.id,
      'denyingGoalscoringOpportunity',
      DAYS[2] ?? '',
    );
    expect(red.accumulationBan).toBe(2);
    expect(red.straightBan).toBe(1);
    // The fifth point on 20 September carried its own match, served on 11 October.
    const carried = await gameOnDay(f, league, '2031-10-11', 1, true);
    await play(f, carried);

    const straight = await gameOnDay(f, league, '2031-10-12', 0, false);
    const barred = await eligibility(f, straight.id);
    expect(barred.body.ineligible.map((line: { playerId: number }) => line.playerId)).toEqual([
      league.player.id,
    ]);
    expect(barred.body.ineligible[0].outstanding).toBe(2);
    await play(f, straight);

    const eleventh = await gameOnDay(f, league, '2031-10-15', 2, true);
    const freed = await eligibility(f, eleventh.id);
    expect(freed.body.ineligible).toEqual([]);
    await play(f, eleventh);

    const fourteenth = await gameOn(f, league, 3);
    expect(fourteenth.playedOn).toBe('2031-10-18');
    const again = await eligibility(f, fourteenth.id);
    expect(again.body.ineligible).toHaveLength(1);
    expect(again.body.ineligible[0].outstanding).toBe(1);
  });
});

describe('the standing a record reads', () => {
  it('drops back once the ban has been served, with the ban still counted', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');
    const second = await gameOn(f, league, 1);
    await play(f, second);
    const res = await record(f, league.player.id);
    expect(res.body.standing).toBe('warned');
    expect(res.body.matchesBanned).toBe(1);
    expect(res.body.points).toBe(3);
  });

  it('answers the standing for the day asked about', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');
    const second = await gameOn(f, league, 1);
    await play(f, second);
    const before = await record(f, league.player.id, '2031-09-19');
    expect(before.body.standing).toBe('suspended');
    const after = await record(f, league.player.id, DAYS[1] ?? '');
    expect(after.body.standing).toBe('warned');
  });

  it('is not moved by an awarded game, only by a played one', async () => {
    const f = floor();
    const league = await aLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'denyingGoalscoringOpportunity', DAYS[0] ?? '');
    const second = await gameOn(f, league, 1);
    await api(f).post(`/fixtures/${second.id}/award`).send({
      awardedOn: DAYS[1],
      awardedToTeamId: league.side.id,
      reason: 'withdrawal',
    });
    const third = await gameOn(f, league, 2);
    await play(f, third);

    const afterAward = await record(f, league.player.id, DAYS[1] ?? '');
    expect(afterAward.body.standing).toBe('suspended');
    const afterGame = await record(f, league.player.id, DAYS[2] ?? '');
    expect(afterGame.body.standing).toBe('warned');
    expect(afterGame.body.matchesBanned).toBe(1);
  });
});

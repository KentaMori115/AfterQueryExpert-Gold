import {
  aFixedLeague,
  aFixture,
  api,
  bare,
  floor,
  staffWith,
  type Floor,
} from '../../../tests/helpers';

const MATCH_DAYS = [
  '2031-09-06',
  '2031-10-04',
  '2031-11-01',
  '2031-12-06',
  '2032-01-10',
  '2032-02-07',
  '2032-03-06',
];

/**
 * A league with a player at the home club, and a run of games that player's
 * side is in, so cards can be piled up across ordered fixtures.
 */
async function aBookableLeague(f: Floor) {
  const league = await aFixedLeague(f, 4, { teamCapacity: 10 });
  const home = league.teams[0];
  const others = league.teams.slice(1);
  const homeClub = league.clubs[0];

  const player = await api(f).post(`/clubs/${homeClub?.id}/players`).send({
    firstName: 'Owen',
    lastName: 'Tasker',
    bornOn: '2005-03-14',
    position: 'midfielder',
    squadNumber: 8,
    registeredOn: '2031-07-20',
  });

  return { ...league, home, others, homeClub, player: player.body };
}

/** Puts the home side in a game on the given match day. */
async function gameOn(
  f: Floor,
  league: Awaited<ReturnType<typeof aBookableLeague>>,
  index: number,
) {
  const opponent = league.others[index % league.others.length];
  const atHome = index % 2 === 0;
  return aFixture(
    f,
    league.division.id,
    atHome ? league.home?.id : opponent?.id,
    atHome ? opponent?.id : league.home?.id,
    league.venue.id,
    { playedOn: MATCH_DAYS[index] ?? '' },
  );
}

async function book(
  f: Floor,
  fixtureId: number,
  playerId: number,
  offence: string,
  shownOn: string,
) {
  return api(f).post(`/fixtures/${fixtureId}/cards`).send({ playerId, offence, shownOn });
}

describe('showing a card', () => {
  it('answers the whole shape back, with what the card cost', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const fixture = await gameOn(f, league, 0);
    const res = await book(f, fixture.id, league.player.id, 'dissent', MATCH_DAYS[0] ?? '');

    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual([
      'accumulationBan',
      'colour',
      'createdAt',
      'finePence',
      'fixtureId',
      'id',
      'offence',
      'playerId',
      'points',
      'rescindedOn',
      'runningPoints',
      'shownOn',
      'status',
      'straightBan',
      'teamId',
      'updatedAt',
    ]);
    expect(res.body.colour).toBe('yellow');
    expect(res.body.points).toBe(1);
    expect(res.body.finePence).toBe(1000);
    expect(res.body.straightBan).toBe(0);
    expect(res.body.accumulationBan).toBe(0);
    expect(res.body.runningPoints).toBe(1);
    expect(res.body.status).toBe('recorded');
    expect(res.body.rescindedOn).toBe(null);
  });

  it('shows the colour and tariff the offence carries, not one the caller picks', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const fixture = await gameOn(f, league, 0);
    const res = await book(f, fixture.id, league.player.id, 'violentConduct', MATCH_DAYS[0] ?? '');
    expect(res.body.colour).toBe('red');
    expect(res.body.points).toBe(6);
    expect(res.body.finePence).toBe(8000);
    expect(res.body.straightBan).toBe(3);
  });

  it('bans a player straight away for the worst offences and not for the lesser ones', async () => {
    for (const [offence, ban] of [
      ['dissent', 0],
      ['persistentFouling', 0],
      ['denyingGoalscoringOpportunity', 1],
      ['seriousFoulPlay', 2],
      ['violentConduct', 3],
    ] as const) {
      // A fresh floor per offence: the league builder names its clubs the same
      // way every time, so two leagues cannot share one database.
      const f = floor();
      const league = await aBookableLeague(f);
      const fixture = await gameOn(f, league, 0);
      const res = await book(f, fixture.id, league.player.id, offence, MATCH_DAYS[0] ?? '');
      expect(res.status).toBe(201);
      expect(res.body.straightBan).toBe(ban);
    }
  });

  it('refuses an offence the league does not have', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const fixture = await gameOn(f, league, 0);
    const res = await book(f, fixture.id, league.player.id, 'timeWasting', MATCH_DAYS[0] ?? '');
    expect(res.status).toBe(400);
  });

  it('insists the card is shown on the day the game was played', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const fixture = await gameOn(f, league, 0);
    const res = await book(f, fixture.id, league.player.id, 'dissent', MATCH_DAYS[1] ?? '');
    expect(res.status).toBe(409);
  });

  it('refuses a player at neither club in the game', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const stranger = await api(f).post(`/clubs/${league.clubs[2]?.id}/players`).send({
      firstName: 'Nathan',
      lastName: 'Ives',
      bornOn: '2004-01-09',
      position: 'defender',
      squadNumber: 5,
      registeredOn: '2031-07-20',
    });
    const fixture = await aFixture(
      f,
      league.division.id,
      league.home?.id,
      league.others[0]?.id,
      league.venue.id,
      { playedOn: MATCH_DAYS[0] ?? '' },
    );
    const res = await book(f, fixture.id, stranger.body.id, 'dissent', MATCH_DAYS[0] ?? '');
    expect(res.status).toBe(409);
  });

  it('refuses a released player', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const fixture = await gameOn(f, league, 0);
    await api(f).post(`/players/${league.player.id}/release`).send({ releasedOn: '2031-08-01' });
    const res = await book(f, fixture.id, league.player.id, 'dissent', MATCH_DAYS[0] ?? '');
    expect(res.status).toBe(409);
  });

  it('refuses a second sending off in the same game but allows a second booking', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const fixture = await gameOn(f, league, 0);
    const first = await book(f, fixture.id, league.player.id, 'dissent', MATCH_DAYS[0] ?? '');
    expect(first.status).toBe(201);

    const second = await book(
      f,
      fixture.id,
      league.player.id,
      'unsportingBehaviour',
      MATCH_DAYS[0] ?? '',
    );
    expect(second.status).toBe(201);

    const sentOff = await book(
      f,
      fixture.id,
      league.player.id,
      'seriousFoulPlay',
      MATCH_DAYS[0] ?? '',
    );
    expect(sentOff.status).toBe(201);

    const again = await book(f, fixture.id, league.player.id, 'dissent', MATCH_DAYS[0] ?? '');
    expect(again.status).toBe(409);
  });

  it('refuses a card in a game that was called off', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const fixture = await gameOn(f, league, 0);
    await api(f).post(`/fixtures/${fixture.id}/postpone`).send({ postponedOn: '2031-09-05' });
    const res = await book(f, fixture.id, league.player.id, 'dissent', MATCH_DAYS[0] ?? '');
    expect(res.status).toBe(409);
  });

  it('refuses a malformed day and one that never happened', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const fixture = await gameOn(f, league, 0);
    expect((await book(f, fixture.id, league.player.id, 'dissent', '06-09-2031')).status).toBe(400);
    expect((await book(f, fixture.id, league.player.id, 'dissent', '2031-09-31')).status).toBe(409);
  });

  it('refuses each required field being left out', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const fixture = await gameOn(f, league, 0);
    const full: Record<string, unknown> = {
      playerId: league.player.id,
      offence: 'dissent',
      shownOn: MATCH_DAYS[0],
    };
    for (const field of ['playerId', 'offence', 'shownOn']) {
      const body = { ...full };
      delete body[field];
      expect((await api(f).post(`/fixtures/${fixture.id}/cards`).send(body)).status).toBe(400);
    }
  });

  it('refuses a body carrying a field it does not know', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const fixture = await gameOn(f, league, 0);
    const res = await api(f).post(`/fixtures/${fixture.id}/cards`).send({
      playerId: league.player.id,
      offence: 'dissent',
      shownOn: MATCH_DAYS[0],
      minute: 63,
    });
    expect(res.status).toBe(400);
  });

  it('refuses a query on a route that takes no filters', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const fixture = await gameOn(f, league, 0);
    const res = await api(f)
      .post(`/fixtures/${fixture.id}/cards?notify=true`)
      .send({ playerId: league.player.id, offence: 'dissent', shownOn: MATCH_DAYS[0] });
    expect(res.status).toBe(400);
  });

  it('answers 404 for a game or a player that does not exist', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const fixture = await gameOn(f, league, 0);
    expect((await book(f, 9907, league.player.id, 'dissent', MATCH_DAYS[0] ?? '')).status).toBe(
      404,
    );
    expect((await book(f, fixture.id, 9907, 'dissent', MATCH_DAYS[0] ?? '')).status).toBe(404);
  });
});

describe('what a run of cards adds up to', () => {
  it('carries the running total forward across games', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const totals: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const fixture = await gameOn(f, league, index);
      const res = await book(
        f,
        fixture.id,
        league.player.id,
        'persistentFouling',
        MATCH_DAYS[index] ?? '',
      );
      totals.push(res.body.runningPoints);
    }
    expect(totals).toEqual([2, 4, 6]);
  });

  it('bans a player the game their total first reaches five', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const bans: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const fixture = await gameOn(f, league, index);
      const res = await book(f, fixture.id, league.player.id, 'dissent', MATCH_DAYS[index] ?? '');
      bans.push(res.body.accumulationBan);
    }
    expect(bans).toEqual([0, 0, 0, 0, 1]);
  });

  it('bans nobody twice for sitting on a threshold it already crossed', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const bans: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const fixture = await gameOn(f, league, index);
      const res = await book(f, fixture.id, league.player.id, 'dissent', MATCH_DAYS[index] ?? '');
      bans.push(res.body.accumulationBan);
    }
    expect(bans).toEqual([0, 0, 0, 0, 1, 0]);
  });

  it('gives the heavier ban when one card jumps clean over a threshold', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    // Two heavy fouls put the player on 8, then a third crosses ten in one go.
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'seriousFoulPlay', MATCH_DAYS[0] ?? '');
    const second = await gameOn(f, league, 1);
    const onEight = await book(
      f,
      second.id,
      league.player.id,
      'seriousFoulPlay',
      MATCH_DAYS[1] ?? '',
    );
    expect(onEight.body.runningPoints).toBe(8);
    expect(onEight.body.accumulationBan).toBe(1);

    const third = await gameOn(f, league, 2);
    const crossesTen = await book(
      f,
      third.id,
      league.player.id,
      'persistentFouling',
      MATCH_DAYS[2] ?? '',
    );
    expect(crossesTen.body.runningPoints).toBe(10);
    expect(crossesTen.body.accumulationBan).toBe(2);
  });

  it('serves a straight ban and an accumulated one together rather than adding them', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    for (let index = 0; index < 2; index += 1) {
      const fixture = await gameOn(f, league, index);
      await book(f, fixture.id, league.player.id, 'persistentFouling', MATCH_DAYS[index] ?? '');
    }
    // On 4, a red for violent conduct is worth 6 points: crosses five (one match)
    // but carries a straight three, so the ban is three, not four.
    const fixture = await gameOn(f, league, 2);
    const red = await book(f, fixture.id, league.player.id, 'violentConduct', MATCH_DAYS[2] ?? '');
    expect(red.body.runningPoints).toBe(10);
    expect(red.body.straightBan).toBe(3);
    expect(red.body.accumulationBan).toBe(2);

    const record = await api(f).get(`/players/${league.player.id}/record?asOf=2032-05-16`);
    expect(record.body.matchesBanned).toBe(3);
  });
});

describe('what a player record adds up to', () => {
  it('answers every field of an untouched record by value', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const res = await api(f).get(`/players/${league.player.id}/record?asOf=2032-05-16`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'asOf',
      'cards',
      'clubId',
      'finesPence',
      'matchesBanned',
      'playerId',
      'points',
      'reds',
      'standing',
      'yellows',
    ]);
    expect(res.body.cards).toBe(0);
    expect(res.body.yellows).toBe(0);
    expect(res.body.reds).toBe(0);
    expect(res.body.points).toBe(0);
    expect(res.body.finesPence).toBe(0);
    expect(res.body.matchesBanned).toBe(0);
    expect(res.body.standing).toBe('clear');
  });

  it('adds the fines up in whole pence', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'dissent', MATCH_DAYS[0] ?? '');
    const second = await gameOn(f, league, 1);
    await book(f, second.id, league.player.id, 'persistentFouling', MATCH_DAYS[1] ?? '');

    const res = await api(f).get(`/players/${league.player.id}/record?asOf=2032-05-16`);
    expect(res.body.finesPence).toBe(2500);
    expect(res.body.points).toBe(3);
    expect(res.body.yellows).toBe(2);
    expect(res.body.reds).toBe(0);
  });

  it('moves a player from clear to warned to suspended', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const clear = await api(f).get(`/players/${league.player.id}/record?asOf=2032-05-16`);
    expect(clear.body.standing).toBe('clear');

    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'persistentFouling', MATCH_DAYS[0] ?? '');
    const warned = await api(f).get(`/players/${league.player.id}/record?asOf=2032-05-16`);
    expect(warned.body.points).toBe(2);
    expect(warned.body.standing).toBe('clear');

    const second = await gameOn(f, league, 1);
    await book(f, second.id, league.player.id, 'dissent', MATCH_DAYS[1] ?? '');
    const nowWarned = await api(f).get(`/players/${league.player.id}/record?asOf=2032-05-16`);
    expect(nowWarned.body.points).toBe(3);
    expect(nowWarned.body.standing).toBe('warned');

    const third = await gameOn(f, league, 2);
    await book(f, third.id, league.player.id, 'violentConduct', MATCH_DAYS[2] ?? '');
    const suspended = await api(f).get(`/players/${league.player.id}/record?asOf=2032-05-16`);
    expect(suspended.body.standing).toBe('suspended');
  });

  it('leaves out cards shown after the day asked for', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const first = await gameOn(f, league, 0);
    await book(f, first.id, league.player.id, 'dissent', MATCH_DAYS[0] ?? '');
    const second = await gameOn(f, league, 2);
    await book(f, second.id, league.player.id, 'dissent', MATCH_DAYS[2] ?? '');

    const early = await api(f).get(`/players/${league.player.id}/record?asOf=2031-09-30`);
    expect(early.body.cards).toBe(1);
    const later = await api(f).get(`/players/${league.player.id}/record?asOf=2031-11-30`);
    expect(later.body.cards).toBe(2);
  });

  it('insists on being told which day to read it for', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    expect((await api(f).get(`/players/${league.player.id}/record`)).status).toBe(400);
    expect((await api(f).get(`/players/${league.player.id}/record?asOf=06-09-2031`)).status).toBe(
      400,
    );
    expect((await api(f).get(`/players/${league.player.id}/record?asOf=2031-09-31`)).status).toBe(
      409,
    );
  });

  it('answers 404 for a player nobody registered', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    expect((await api(f).get(`/players/${league.player.id}/record?asOf=2032-05-16`)).status).toBe(
      200,
    );
    expect((await api(f).get('/players/9907/record?asOf=2032-05-16')).status).toBe(404);
  });
});

describe('taking a card off the record', () => {
  it('rescinds a card and writes the day down', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const fixture = await gameOn(f, league, 0);
    const card = await book(f, fixture.id, league.player.id, 'dissent', MATCH_DAYS[0] ?? '');
    const res = await api(f)
      .post(`/cards/${card.body.id}/rescind`)
      .send({ rescindedOn: '2031-09-20' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rescinded');
    expect(res.body.rescindedOn).toBe('2031-09-20');
  });

  it('takes the rescinded card out of the record', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const fixture = await gameOn(f, league, 0);
    const card = await book(
      f,
      fixture.id,
      league.player.id,
      'persistentFouling',
      MATCH_DAYS[0] ?? '',
    );
    await api(f).post(`/cards/${card.body.id}/rescind`).send({ rescindedOn: '2031-09-20' });

    const res = await api(f).get(`/players/${league.player.id}/record?asOf=2032-05-16`);
    expect(res.body.cards).toBe(0);
    expect(res.body.points).toBe(0);
    expect(res.body.finesPence).toBe(0);
  });

  it('reworks the cards that came after, undoing a ban they had already earned', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const cards = [];
    for (let index = 0; index < 5; index += 1) {
      const fixture = await gameOn(f, league, index);
      const res = await book(f, fixture.id, league.player.id, 'dissent', MATCH_DAYS[index] ?? '');
      cards.push(res.body);
    }
    // The fifth card earned the ban. Taking the first away leaves everybody on
    // four points, so nothing crossed five and the ban goes with it.
    expect(cards[4].accumulationBan).toBe(1);

    await api(f).post(`/cards/${cards[0].id}/rescind`).send({ rescindedOn: '2031-09-20' });

    const fifth = await api(f).get(`/cards/${cards[4].id}`);
    expect(fifth.body.runningPoints).toBe(4);
    expect(fifth.body.accumulationBan).toBe(0);

    const record = await api(f).get(`/players/${league.player.id}/record?asOf=2032-05-16`);
    expect(record.body.points).toBe(4);
    expect(record.body.matchesBanned).toBe(0);
    expect(record.body.standing).toBe('warned');
  });

  it('refuses rescinding twice and rescinding before the card was shown', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const fixture = await gameOn(f, league, 0);
    const card = await book(f, fixture.id, league.player.id, 'dissent', MATCH_DAYS[0] ?? '');
    expect(
      (await api(f).post(`/cards/${card.body.id}/rescind`).send({ rescindedOn: '2031-09-05' }))
        .status,
    ).toBe(409);
    await api(f).post(`/cards/${card.body.id}/rescind`).send({ rescindedOn: '2031-09-20' });
    expect(
      (await api(f).post(`/cards/${card.body.id}/rescind`).send({ rescindedOn: '2031-09-21' }))
        .status,
    ).toBe(409);
  });

  it('refuses an impossible day and a body naming the wrong field', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const fixture = await gameOn(f, league, 0);
    const card = await book(f, fixture.id, league.player.id, 'dissent', MATCH_DAYS[0] ?? '');
    expect(
      (await api(f).post(`/cards/${card.body.id}/rescind`).send({ rescindedOn: '2031-09-31' }))
        .status,
    ).toBe(409);
    expect(
      (await api(f).post(`/cards/${card.body.id}/rescind`).send({ shownOn: '2031-09-20' })).status,
    ).toBe(400);
  });

  it('answers 404 for a card nobody showed', async () => {
    const f = floor();
    await aBookableLeague(f);
    expect(
      (await api(f).post('/cards/9907/rescind').send({ rescindedOn: '2031-09-20' })).status,
    ).toBe(404);
    expect((await api(f).get('/cards/9907')).status).toBe(404);
  });
});

describe('reading cards back', () => {
  it('answers both lists in a wrapper, oldest first', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const first = await gameOn(f, league, 0);
    const early = await book(f, first.id, league.player.id, 'dissent', MATCH_DAYS[0] ?? '');
    const second = await gameOn(f, league, 1);
    const late = await book(f, second.id, league.player.id, 'dissent', MATCH_DAYS[1] ?? '');

    const all = await api(f).get('/cards');
    expect(all.status).toBe(200);
    expect(all.body.items.map((c: { id: number }) => c.id)).toEqual([early.body.id, late.body.id]);

    const forFixture = await api(f).get(`/fixtures/${first.id}/cards`);
    expect(forFixture.body.items.map((c: { id: number }) => c.id)).toEqual([early.body.id]);
  });

  it('narrows both lists by player, side, colour and status', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const fixture = await gameOn(f, league, 0);
    const yellow = await book(f, fixture.id, league.player.id, 'dissent', MATCH_DAYS[0] ?? '');
    const red = await book(f, fixture.id, league.player.id, 'seriousFoulPlay', MATCH_DAYS[0] ?? '');

    expect(
      (await api(f).get(`/cards?playerId=${league.player.id}`)).body.items.map(
        (c: { id: number }) => c.id,
      ),
    ).toEqual([yellow.body.id, red.body.id]);
    expect(
      (await api(f).get('/cards?colour=red')).body.items.map((c: { id: number }) => c.id),
    ).toEqual([red.body.id]);
    expect((await api(f).get(`/cards?teamId=${league.home?.id}`)).body.items.length).toBe(2);

    await api(f).post(`/cards/${yellow.body.id}/rescind`).send({ rescindedOn: '2031-09-20' });
    expect(
      (await api(f).get('/cards?status=rescinded')).body.items.map((c: { id: number }) => c.id),
    ).toEqual([yellow.body.id]);
  });

  it('answers 404 when filtering by something that does not exist', async () => {
    const f = floor();
    await aBookableLeague(f);
    expect((await api(f).get('/cards?playerId=9907')).status).toBe(404);
    expect((await api(f).get('/cards?teamId=9907')).status).toBe(404);
    expect((await api(f).get('/cards?fixtureId=9907')).status).toBe(404);
    expect((await api(f).get('/fixtures/9907/cards')).status).toBe(404);
  });

  it('refuses a filter neither list offers', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const fixture = await gameOn(f, league, 0);
    expect((await api(f).get('/cards?offence=dissent')).status).toBe(400);
    expect((await api(f).get(`/fixtures/${fixture.id}/cards?offence=dissent`)).status).toBe(400);
    expect((await api(f).get('/cards')).status).toBe(200);
  });

  it('answers an empty list before any card is shown', async () => {
    const f = floor();
    await aBookableLeague(f);
    expect((await api(f).get('/cards')).body).toEqual({ items: [] });
  });
});

describe('who may settle discipline', () => {
  it('needs a token on every discipline route', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const fixture = await gameOn(f, league, 0);
    const card = await book(f, fixture.id, league.player.id, 'dissent', MATCH_DAYS[0] ?? '');

    expect((await bare(f).post(`/fixtures/${fixture.id}/cards`).send({})).status).toBe(401);
    expect((await bare(f).get(`/fixtures/${fixture.id}/cards`)).status).toBe(401);
    expect((await bare(f).get('/cards')).status).toBe(401);
    expect((await bare(f).get(`/cards/${card.body.id}`)).status).toBe(401);
    expect((await bare(f).post(`/cards/${card.body.id}/rescind`).send({})).status).toBe(401);
    expect((await bare(f).get(`/players/${league.player.id}/record?asOf=2032-05-16`)).status).toBe(
      401,
    );
  });

  it('lets the discipline officer rule but stops the registrar', async () => {
    const f = floor();
    const league = await aBookableLeague(f);
    const fixture = await gameOn(f, league, 0);
    const officer = staffWith(f, 'discipline', 'disc-card@touchline.example');
    const registrar = staffWith(f, 'registrar', 'reg-card@touchline.example');

    const ruled = await api(f, officer)
      .post(`/fixtures/${fixture.id}/cards`)
      .send({ playerId: league.player.id, offence: 'dissent', shownOn: MATCH_DAYS[0] });
    expect(ruled.status).toBe(201);

    const refused = await api(f, registrar)
      .post(`/fixtures/${fixture.id}/cards`)
      .send({ playerId: league.player.id, offence: 'dissent', shownOn: MATCH_DAYS[0] });
    expect(refused.status).toBe(409);

    expect((await api(f, registrar).get('/cards')).status).toBe(200);
  });
});

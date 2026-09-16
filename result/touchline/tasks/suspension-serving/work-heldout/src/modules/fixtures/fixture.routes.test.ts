import { aFixedLeague, aFixture, api, bare, floor, staffWith } from '../../../tests/helpers';

function ids(items: { id: number }[]): number[] {
  return items.map((item) => item.id);
}

describe('putting a game in the book', () => {
  it('answers the whole shape back, scheduled and not called off', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const res = await api(f).post(`/divisions/${division.id}/fixtures`).send({
      homeTeamId: teams[0]?.id,
      awayTeamId: teams[1]?.id,
      venueId: venue.id,
      playedOn: '2031-09-06',
      kickOff: '14:00',
    });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual([
      'awardReason',
      'awardedToTeamId',
      'awayTeamId',
      'createdAt',
      'divisionId',
      'homeTeamId',
      'id',
      'kickOff',
      'playedOn',
      'postponedOn',
      'status',
      'updatedAt',
      'venueId',
    ]);
    expect(res.body.status).toBe('scheduled');
    expect(res.body.postponedOn).toBe(null);
    expect(res.body.awardedToTeamId).toBe(null);
    expect(res.body.awardReason).toBe(null);
  });

  it('refuses a side playing itself', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const res = await api(f).post(`/divisions/${division.id}/fixtures`).send({
      homeTeamId: teams[0]?.id,
      awayTeamId: teams[0]?.id,
      venueId: venue.id,
      playedOn: '2031-09-06',
      kickOff: '14:00',
    });
    expect(res.status).toBe(409);
  });

  it('refuses a side from another division and one that has withdrawn', async () => {
    const f = floor();
    const { season, division, teams, venue, clubs } = await aFixedLeague(f);
    const other = await api(f).post(`/seasons/${season.id}/divisions`).send({
      name: 'Championship',
      tier: 2,
      teamCapacity: 4,
      promotionPlaces: 1,
      relegationPlaces: 1,
    });
    const outsider = await api(f)
      .post(`/divisions/${other.body.id}/teams`)
      .send({ clubId: clubs[0]?.id, rank: 'reserves', enteredOn: '2031-07-16' });

    const fromElsewhere = await api(f).post(`/divisions/${division.id}/fixtures`).send({
      homeTeamId: teams[0]?.id,
      awayTeamId: outsider.body.id,
      venueId: venue.id,
      playedOn: '2031-09-06',
      kickOff: '14:00',
    });
    expect(fromElsewhere.status).toBe(409);
  });

  it('refuses a game outside the season it belongs to', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const before = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id, {
      playedOn: '2031-08-08',
    });
    expect(before.error.code).toBe('conflict');

    const after = await api(f).post(`/divisions/${division.id}/fixtures`).send({
      homeTeamId: teams[0]?.id,
      awayTeamId: teams[1]?.id,
      venueId: venue.id,
      playedOn: '2032-05-17',
      kickOff: '14:00',
    });
    expect(after.status).toBe(409);
  });

  it('needs a ground that can be lit for a late kick-off', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const dark = await api(f).post(`/divisions/${division.id}/fixtures`).send({
      homeTeamId: teams[0]?.id,
      awayTeamId: teams[1]?.id,
      venueId: venue.id,
      playedOn: '2031-09-06',
      kickOff: '15:00',
    });
    expect(dark.status).toBe(409);

    const stillLight = await api(f).post(`/divisions/${division.id}/fixtures`).send({
      homeTeamId: teams[0]?.id,
      awayTeamId: teams[1]?.id,
      venueId: venue.id,
      playedOn: '2031-09-06',
      kickOff: '14:59',
    });
    expect(stillLight.status).toBe(201);
  });

  it('lets a lit ground take the same late kick-off', async () => {
    const f = floor();
    const { division, teams } = await aFixedLeague(f);
    const lit = await api(f).post('/venues').send({
      name: 'Ashcroft Dome',
      addressLine: '1 Dome Way',
      postcode: 'RG9 1AA',
      surface: 'threeG',
      pitchCount: 2,
      floodlit: true,
    });
    const res = await api(f).post(`/divisions/${division.id}/fixtures`).send({
      homeTeamId: teams[0]?.id,
      awayTeamId: teams[1]?.id,
      venueId: lit.body.id,
      playedOn: '2031-09-06',
      kickOff: '19:30',
    });
    expect(res.status).toBe(201);
  });

  it('refuses more games at a ground in one day than its surface will take', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f, 4, {}, { pitchCount: 1 });
    await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id, {
      playedOn: '2031-09-06',
    });
    await aFixture(f, division.id, teams[2]?.id, teams[3]?.id, venue.id, {
      playedOn: '2031-09-06',
      kickOff: '11:00',
    });

    const third = await api(f).post(`/divisions/${division.id}/fixtures`).send({
      homeTeamId: teams[1]?.id,
      awayTeamId: teams[0]?.id,
      venueId: venue.id,
      playedOn: '2031-09-06',
      kickOff: '09:00',
    });
    expect(third.status).toBe(409);
  });

  it('refuses a side being drawn twice on the same day', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id);
    const clash = await api(f).post(`/divisions/${division.id}/fixtures`).send({
      homeTeamId: teams[2]?.id,
      awayTeamId: teams[0]?.id,
      venueId: venue.id,
      playedOn: '2031-09-06',
      kickOff: '11:00',
    });
    expect(clash.status).toBe(409);
  });

  it('lets two sides meet as often as a big division plays and no more', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f, 4, { teamCapacity: 10 });
    const home = teams[0]?.id;
    const away = teams[1]?.id;
    const first = await aFixture(f, division.id, home, away, venue.id, { playedOn: '2031-09-06' });
    expect(first.status).toBe('scheduled');

    const sameWayAgain = await api(f).post(`/divisions/${division.id}/fixtures`).send({
      homeTeamId: home,
      awayTeamId: away,
      venueId: venue.id,
      playedOn: '2031-10-04',
      kickOff: '14:00',
    });
    expect(sameWayAgain.status).toBe(409);

    const reverse = await api(f).post(`/divisions/${division.id}/fixtures`).send({
      homeTeamId: away,
      awayTeamId: home,
      venueId: venue.id,
      playedOn: '2031-10-04',
      kickOff: '14:00',
    });
    expect(reverse.status).toBe(201);

    const third = await api(f).post(`/divisions/${division.id}/fixtures`).send({
      homeTeamId: home,
      awayTeamId: away,
      venueId: venue.id,
      playedOn: '2031-11-01',
      kickOff: '14:00',
    });
    expect(third.status).toBe(409);
  });

  it('lets a small division draw the same pair twice at each ground', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f, 4, { teamCapacity: 6 });
    const home = teams[0]?.id;
    const away = teams[1]?.id;
    const days = ['2031-09-06', '2031-10-04', '2031-11-01', '2031-12-06'];

    for (const [index, playedOn] of days.entries()) {
      const atHome = index % 2 === 0;
      const res = await api(f)
        .post(`/divisions/${division.id}/fixtures`)
        .send({
          homeTeamId: atHome ? home : away,
          awayTeamId: atHome ? away : home,
          venueId: venue.id,
          playedOn,
          kickOff: '14:00',
        });
      expect(res.status).toBe(201);
    }

    const fifth = await api(f).post(`/divisions/${division.id}/fixtures`).send({
      homeTeamId: home,
      awayTeamId: away,
      venueId: venue.id,
      playedOn: '2032-01-10',
      kickOff: '14:00',
    });
    expect(fifth.status).toBe(409);
  });

  it('refuses a game in a division whose entries are not fixed', async () => {
    const f = floor();
    const { season, venue, clubs } = await aFixedLeague(f);
    const forming = await api(f).post(`/seasons/${season.id}/divisions`).send({
      name: 'Division One',
      tier: 3,
      teamCapacity: 4,
      promotionPlaces: 1,
      relegationPlaces: 1,
    });
    const a = await api(f)
      .post(`/divisions/${forming.body.id}/teams`)
      .send({ clubId: clubs[0]?.id, rank: 'reserves', enteredOn: '2031-07-16' });
    const b = await api(f)
      .post(`/divisions/${forming.body.id}/teams`)
      .send({ clubId: clubs[1]?.id, rank: 'reserves', enteredOn: '2031-07-16' });

    const res = await api(f).post(`/divisions/${forming.body.id}/fixtures`).send({
      homeTeamId: a.body.id,
      awayTeamId: b.body.id,
      venueId: venue.id,
      playedOn: '2031-09-13',
      kickOff: '14:00',
    });
    expect(res.status).toBe(409);
  });

  it('refuses a closed ground', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    await api(f).post(`/venues/${venue.id}/close`).send({ closedOn: '2031-08-20' });
    const res = await api(f).post(`/divisions/${division.id}/fixtures`).send({
      homeTeamId: teams[0]?.id,
      awayTeamId: teams[1]?.id,
      venueId: venue.id,
      playedOn: '2031-09-06',
      kickOff: '14:00',
    });
    expect(res.status).toBe(409);
  });

  it('refuses a malformed day, an impossible day and a time that is not one', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const send = (over: Record<string, unknown>) =>
      api(f)
        .post(`/divisions/${division.id}/fixtures`)
        .send({
          homeTeamId: teams[0]?.id,
          awayTeamId: teams[1]?.id,
          venueId: venue.id,
          playedOn: '2031-09-06',
          kickOff: '14:00',
          ...over,
        });
    expect((await send({ playedOn: '06-09-2031' })).status).toBe(400);
    expect((await send({ playedOn: '2031-09-31' })).status).toBe(409);
    expect((await send({ kickOff: '25:15' })).status).toBe(400);
    expect((await send({ kickOff: '2pm' })).status).toBe(400);
    expect((await send({ kickOff: '14:60' })).status).toBe(400);
  });

  it('refuses each required field being left out', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const full: Record<string, unknown> = {
      homeTeamId: teams[0]?.id,
      awayTeamId: teams[1]?.id,
      venueId: venue.id,
      playedOn: '2031-09-06',
      kickOff: '14:00',
    };
    for (const field of ['homeTeamId', 'awayTeamId', 'venueId', 'playedOn', 'kickOff']) {
      const body = { ...full };
      delete body[field];
      expect((await api(f).post(`/divisions/${division.id}/fixtures`).send(body)).status).toBe(400);
    }
  });

  it('refuses a body carrying a field it does not know', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const res = await api(f).post(`/divisions/${division.id}/fixtures`).send({
      homeTeamId: teams[0]?.id,
      awayTeamId: teams[1]?.id,
      venueId: venue.id,
      playedOn: '2031-09-06',
      kickOff: '14:00',
      referee: 'Mr Sharma',
    });
    expect(res.status).toBe(400);
  });

  it('refuses a query on a route that takes no filters', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const res = await api(f).post(`/divisions/${division.id}/fixtures?force=true`).send({
      homeTeamId: teams[0]?.id,
      awayTeamId: teams[1]?.id,
      venueId: venue.id,
      playedOn: '2031-09-06',
      kickOff: '14:00',
    });
    expect(res.status).toBe(400);
  });

  it('answers 404 for a division, side or ground that does not exist', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const body = {
      homeTeamId: teams[0]?.id,
      awayTeamId: teams[1]?.id,
      venueId: venue.id,
      playedOn: '2031-09-06',
      kickOff: '14:00',
    };
    expect((await api(f).post('/divisions/9907/fixtures').send(body)).status).toBe(404);
    expect(
      (
        await api(f)
          .post(`/divisions/${division.id}/fixtures`)
          .send({ ...body, awayTeamId: 9907 })
      ).status,
    ).toBe(404);
    expect(
      (
        await api(f)
          .post(`/divisions/${division.id}/fixtures`)
          .send({ ...body, venueId: 9907 })
      ).status,
    ).toBe(404);
  });
});

describe('reading the fixture list', () => {
  it('reads one game', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const made = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id);
    const read = await api(f).get(`/fixtures/${made.id}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(made);
  });

  it('answers 404 for a game nobody arranged', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const made = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id);
    expect((await api(f).get(`/fixtures/${made.id}`)).status).toBe(200);
    expect((await api(f).get('/fixtures/9907')).status).toBe(404);
  });

  it('answers both lists in a wrapper, by day then kick-off then id', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const later = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id, {
      playedOn: '2031-10-04',
    });
    const earlyOnTheDay = await aFixture(f, division.id, teams[2]?.id, teams[3]?.id, venue.id, {
      playedOn: '2031-09-06',
      kickOff: '11:00',
    });
    const lateOnTheDay = await aFixture(f, division.id, teams[3]?.id, teams[2]?.id, venue.id, {
      playedOn: '2031-09-13',
      kickOff: '14:00',
    });

    const forDivision = await api(f).get(`/divisions/${division.id}/fixtures`);
    expect(forDivision.status).toBe(200);
    expect(ids(forDivision.body.items)).toEqual([earlyOnTheDay.id, lateOnTheDay.id, later.id]);

    const all = await api(f).get('/fixtures');
    expect(ids(all.body.items)).toEqual([earlyOnTheDay.id, lateOnTheDay.id, later.id]);
  });

  it('narrows both lists by side, ground, status and day', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const one = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id);
    const two = await aFixture(f, division.id, teams[2]?.id, teams[3]?.id, venue.id, {
      playedOn: '2031-10-04',
    });

    expect(ids((await api(f).get(`/fixtures?teamId=${teams[0]?.id}`)).body.items)).toEqual([
      one.id,
    ]);
    expect(ids((await api(f).get(`/fixtures?venueId=${venue.id}`)).body.items)).toEqual([
      one.id,
      two.id,
    ]);
    expect(ids((await api(f).get('/fixtures?playedOn=2031-10-04')).body.items)).toEqual([two.id]);

    await api(f).post(`/fixtures/${one.id}/postpone`).send({ postponedOn: '2031-09-05' });
    expect(ids((await api(f).get('/fixtures?status=postponed')).body.items)).toEqual([one.id]);
  });

  it('answers 404 when filtering by something that does not exist', async () => {
    const f = floor();
    const { division } = await aFixedLeague(f);
    expect((await api(f).get(`/divisions/${division.id}/fixtures`)).status).toBe(200);
    expect((await api(f).get('/divisions/9907/fixtures')).status).toBe(404);
    expect((await api(f).get('/fixtures?teamId=9907')).status).toBe(404);
    expect((await api(f).get('/fixtures?venueId=9907')).status).toBe(404);
  });

  it('refuses an impossible day as a filter', async () => {
    const f = floor();
    await aFixedLeague(f);
    expect((await api(f).get('/fixtures?playedOn=2031-09-31')).status).toBe(409);
    expect((await api(f).get('/fixtures?playedOn=06-09-2031')).status).toBe(400);
  });

  it('refuses a filter neither list offers', async () => {
    const f = floor();
    const { division } = await aFixedLeague(f);
    expect((await api(f).get(`/divisions/${division.id}/fixtures?kickOff=14:00`)).status).toBe(400);
    expect((await api(f).get('/fixtures?kickOff=14:00')).status).toBe(400);
    expect((await api(f).get('/fixtures')).status).toBe(200);
  });

  it('answers an empty list for a division with nothing arranged', async () => {
    const f = floor();
    const { division } = await aFixedLeague(f);
    expect((await api(f).get(`/divisions/${division.id}/fixtures`)).body).toEqual({ items: [] });
  });
});

describe('calling a game off and putting it back on', () => {
  it('postpones a game and writes the day down', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const made = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id);
    const res = await api(f)
      .post(`/fixtures/${made.id}/postpone`)
      .send({ postponedOn: '2031-09-05' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('postponed');
    expect(res.body.postponedOn).toBe('2031-09-05');
  });

  it('will not postpone after the game was due to be played', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const made = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id);
    const res = await api(f)
      .post(`/fixtures/${made.id}/postpone`)
      .send({ postponedOn: '2031-09-07' });
    expect(res.status).toBe(409);
  });

  it('puts a called-off game back on another day and forgets it was called off', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const made = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id);
    await api(f).post(`/fixtures/${made.id}/postpone`).send({ postponedOn: '2031-09-05' });
    const res = await api(f)
      .post(`/fixtures/${made.id}/reschedule`)
      .send({ playedOn: '2031-11-08', kickOff: '13:30' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('scheduled');
    expect(res.body.playedOn).toBe('2031-11-08');
    expect(res.body.kickOff).toBe('13:30');
    expect(res.body.postponedOn).toBe(null);
  });

  it('moves the game to another ground when rearranged onto one', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const lit = await api(f).post('/venues').send({
      name: 'Ashcroft Dome',
      addressLine: '1 Dome Way',
      postcode: 'RG9 1AA',
      surface: 'threeG',
      pitchCount: 2,
      floodlit: true,
    });
    const made = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id);
    await api(f).post(`/fixtures/${made.id}/postpone`).send({ postponedOn: '2031-09-05' });
    const res = await api(f)
      .post(`/fixtures/${made.id}/reschedule`)
      .send({ playedOn: '2031-11-08', kickOff: '19:30', venueId: lit.body.id });
    expect(res.status).toBe(200);
    expect(res.body.venueId).toBe(lit.body.id);
  });

  it('checks the ground and the clash rules again when rearranging', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const made = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id);
    const other = await aFixture(f, division.id, teams[2]?.id, teams[3]?.id, venue.id, {
      playedOn: '2031-11-08',
      kickOff: '11:00',
    });
    expect(other.status).toBe('scheduled');
    await api(f).post(`/fixtures/${made.id}/postpone`).send({ postponedOn: '2031-09-05' });

    const dark = await api(f)
      .post(`/fixtures/${made.id}/reschedule`)
      .send({ playedOn: '2031-11-08', kickOff: '16:00' });
    expect(dark.status).toBe(409);

    const fine = await api(f)
      .post(`/fixtures/${made.id}/reschedule`)
      .send({ playedOn: '2031-11-08', kickOff: '13:30' });
    expect(fine.status).toBe(200);
  });

  it('abandons a game and lets it be put back on', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const made = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id);
    const res = await api(f)
      .post(`/fixtures/${made.id}/abandon`)
      .send({ abandonedOn: '2031-09-06' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('abandoned');

    const back = await api(f)
      .post(`/fixtures/${made.id}/reschedule`)
      .send({ playedOn: '2031-11-08', kickOff: '13:30' });
    expect(back.status).toBe(200);
  });

  it('will not abandon a game before it kicked off', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const made = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id);
    expect(
      (await api(f).post(`/fixtures/${made.id}/abandon`).send({ abandonedOn: '2031-09-05' }))
        .status,
    ).toBe(409);
  });

  it('refuses every transition the game is not standing at', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const made = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id);
    expect(
      (
        await api(f)
          .post(`/fixtures/${made.id}/reschedule`)
          .send({ playedOn: '2031-11-08', kickOff: '13:30' })
      ).status,
    ).toBe(409);

    await api(f).post(`/fixtures/${made.id}/postpone`).send({ postponedOn: '2031-09-05' });
    expect(
      (await api(f).post(`/fixtures/${made.id}/postpone`).send({ postponedOn: '2031-09-04' }))
        .status,
    ).toBe(409);
    expect(
      (await api(f).post(`/fixtures/${made.id}/abandon`).send({ abandonedOn: '2031-09-06' }))
        .status,
    ).toBe(409);
  });

  it('refuses a day that never happened on every transition that takes one', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const made = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id);

    expect(
      (await api(f).post(`/fixtures/${made.id}/postpone`).send({ postponedOn: '2031-09-31' }))
        .status,
    ).toBe(409);
    expect(
      (await api(f).post(`/fixtures/${made.id}/abandon`).send({ abandonedOn: '2031-11-31' }))
        .status,
    ).toBe(409);

    await api(f).post(`/fixtures/${made.id}/postpone`).send({ postponedOn: '2031-09-05' });
    expect(
      (
        await api(f)
          .post(`/fixtures/${made.id}/reschedule`)
          .send({ playedOn: '2032-02-30', kickOff: '13:30' })
      ).status,
    ).toBe(409);
  });

  it('refuses a transition body naming the wrong day field', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const made = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id);
    expect(
      (await api(f).post(`/fixtures/${made.id}/postpone`).send({ abandonedOn: '2031-09-05' }))
        .status,
    ).toBe(400);
  });

  it('answers 404 on each transition when the game does not exist', async () => {
    const f = floor();
    await aFixedLeague(f);
    expect(
      (await api(f).post('/fixtures/9907/postpone').send({ postponedOn: '2031-09-05' })).status,
    ).toBe(404);
    expect(
      (await api(f).post('/fixtures/9907/abandon').send({ abandonedOn: '2031-09-06' })).status,
    ).toBe(404);
    expect(
      (
        await api(f)
          .post('/fixtures/9907/reschedule')
          .send({ playedOn: '2031-11-08', kickOff: '13:30' })
      ).status,
    ).toBe(404);
  });
});

describe('awarding a game nobody played', () => {
  it('hands the game to one of the two sides', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const made = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id);
    const res = await api(f)
      .post(`/fixtures/${made.id}/award`)
      .send({ awardedOn: '2031-09-07', awardedToTeamId: teams[0]?.id, reason: 'noShow' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('awarded');
    expect(res.body.awardedToTeamId).toBe(teams[0]?.id);
    expect(res.body.awardReason).toBe('noShow');
  });

  it('refuses awarding it to a side that was not in it', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const made = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id);
    const res = await api(f)
      .post(`/fixtures/${made.id}/award`)
      .send({ awardedOn: '2031-09-07', awardedToTeamId: teams[2]?.id, reason: 'noShow' });
    expect(res.status).toBe(409);
  });

  it('refuses a reason the league does not recognise', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const made = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id);
    const res = await api(f)
      .post(`/fixtures/${made.id}/award`)
      .send({ awardedOn: '2031-09-07', awardedToTeamId: teams[0]?.id, reason: 'badWeather' });
    expect(res.status).toBe(400);
  });

  it('lets a postponed game be awarded but not one already awarded', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const made = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id);
    await api(f).post(`/fixtures/${made.id}/postpone`).send({ postponedOn: '2031-09-05' });
    const first = await api(f)
      .post(`/fixtures/${made.id}/award`)
      .send({ awardedOn: '2031-09-07', awardedToTeamId: teams[1]?.id, reason: 'withdrawal' });
    expect(first.status).toBe(200);

    const again = await api(f)
      .post(`/fixtures/${made.id}/award`)
      .send({ awardedOn: '2031-09-08', awardedToTeamId: teams[0]?.id, reason: 'noShow' });
    expect(again.status).toBe(409);
  });

  it('refuses an impossible day when awarding', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const made = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id);
    const res = await api(f)
      .post(`/fixtures/${made.id}/award`)
      .send({ awardedOn: '2031-09-31', awardedToTeamId: teams[0]?.id, reason: 'noShow' });
    expect(res.status).toBe(409);
  });

  it('refuses each required field of an award being left out', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const made = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id);
    const full: Record<string, unknown> = {
      awardedOn: '2031-09-07',
      awardedToTeamId: teams[0]?.id,
      reason: 'noShow',
    };
    for (const field of ['awardedOn', 'awardedToTeamId', 'reason']) {
      const body = { ...full };
      delete body[field];
      expect((await api(f).post(`/fixtures/${made.id}/award`).send(body)).status).toBe(400);
    }
  });
});

describe('who may settle a fixture', () => {
  it('needs a token on every fixture route', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const made = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id);
    expect((await bare(f).post(`/divisions/${division.id}/fixtures`).send({})).status).toBe(401);
    expect((await bare(f).get(`/divisions/${division.id}/fixtures`)).status).toBe(401);
    expect((await bare(f).get('/fixtures')).status).toBe(401);
    expect((await bare(f).get(`/fixtures/${made.id}`)).status).toBe(401);
    expect(
      (await bare(f).post(`/fixtures/${made.id}/postpone`).send({ postponedOn: '2031-09-05' }))
        .status,
    ).toBe(401);
    expect(
      (await bare(f).post(`/fixtures/${made.id}/abandon`).send({ abandonedOn: '2031-09-06' }))
        .status,
    ).toBe(401);
    expect(
      (
        await bare(f)
          .post(`/fixtures/${made.id}/reschedule`)
          .send({ playedOn: '2031-11-08', kickOff: '13:30' })
      ).status,
    ).toBe(401);
    expect((await bare(f).post(`/fixtures/${made.id}/award`).send({})).status).toBe(401);
  });

  it('lets a registrar read the fixture list but not arrange a game', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const token = staffWith(f, 'registrar', 'reg-fix@touchline.example');
    expect((await api(f, token).get('/fixtures')).status).toBe(200);
    const write = await api(f, token).post(`/divisions/${division.id}/fixtures`).send({
      homeTeamId: teams[0]?.id,
      awayTeamId: teams[1]?.id,
      venueId: venue.id,
      playedOn: '2031-09-06',
      kickOff: '14:00',
    });
    expect(write.status).toBe(409);
  });
});

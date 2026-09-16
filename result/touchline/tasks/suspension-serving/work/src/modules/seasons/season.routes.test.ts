import { api, bare, floor, staffWith, type Floor } from '../../../tests/helpers';

function seasonBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Season 2031-32',
    startsOn: '2031-08-09',
    endsOn: '2032-05-16',
    registrationClosesOn: '2032-03-31',
    ...overrides,
  };
}

async function aSeason(f: Floor, overrides: Record<string, unknown> = {}) {
  const res = await api(f).post('/seasons').send(seasonBody(overrides));
  return res.body;
}

describe('setting a season up', () => {
  it('answers the whole shape back, unopened and unclosed', async () => {
    const f = floor();
    const res = await api(f).post('/seasons').send(seasonBody());
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual([
      'closedOn',
      'createdAt',
      'endsOn',
      'id',
      'name',
      'openedOn',
      'pointsDraw',
      'pointsLoss',
      'pointsWin',
      'registrationClosesOn',
      'startsOn',
      'status',
      'updatedAt',
    ]);
    expect(res.body.status).toBe('planning');
    expect(res.body.openedOn).toBe(null);
    expect(res.body.closedOn).toBe(null);
  });

  it('pays three for a win and one for a draw unless told otherwise', async () => {
    const f = floor();
    const standard = await aSeason(f);
    expect(standard.pointsWin).toBe(3);
    expect(standard.pointsDraw).toBe(1);
    expect(standard.pointsLoss).toBe(0);

    const generous = await aSeason(f, {
      name: 'Season 2033-34',
      startsOn: '2033-08-09',
      endsOn: '2034-05-16',
      registrationClosesOn: '2034-03-31',
      pointsWin: 4,
      pointsDraw: 2,
    });
    expect(generous.pointsWin).toBe(4);
    expect(generous.pointsDraw).toBe(2);
  });

  it('refuses a season that ends before it starts, and one that ends the day it starts', async () => {
    const f = floor();
    const backwards = await api(f)
      .post('/seasons')
      .send(seasonBody({ endsOn: '2031-08-08' }));
    const sameDay = await api(f)
      .post('/seasons')
      .send(seasonBody({ endsOn: '2031-08-09' }));
    expect(backwards.status).toBe(409);
    expect(sameDay.status).toBe(409);
  });

  it('makes registration close inside the season window', async () => {
    const f = floor();
    const tooLate = await api(f)
      .post('/seasons')
      .send(seasonBody({ registrationClosesOn: '2032-05-17' }));
    const tooEarly = await api(f)
      .post('/seasons')
      .send(seasonBody({ registrationClosesOn: '2031-08-08' }));
    expect(tooLate.status).toBe(409);
    expect(tooEarly.status).toBe(409);

    const onTheLastDay = await api(f)
      .post('/seasons')
      .send(seasonBody({ registrationClosesOn: '2032-05-16' }));
    expect(onTheLastDay.status).toBe(201);
  });

  it('refuses a second season by the same name', async () => {
    const f = floor();
    await aSeason(f);
    const again = await api(f)
      .post('/seasons')
      .send(
        seasonBody({
          startsOn: '2035-08-09',
          endsOn: '2036-05-16',
          registrationClosesOn: '2036-03-31',
        }),
      );
    expect(again.status).toBe(409);
  });

  it('refuses a window that overlaps one the league already runs', async () => {
    const f = floor();
    await aSeason(f);
    const overlapping = await api(f)
      .post('/seasons')
      .send(
        seasonBody({
          name: 'Season 2032 spring',
          startsOn: '2032-05-16',
          endsOn: '2032-09-01',
          registrationClosesOn: '2032-08-01',
        }),
      );
    expect(overlapping.status).toBe(409);

    const clear = await api(f)
      .post('/seasons')
      .send(
        seasonBody({
          name: 'Season 2032-33',
          startsOn: '2032-08-08',
          endsOn: '2033-05-15',
          registrationClosesOn: '2033-03-31',
        }),
      );
    expect(clear.status).toBe(201);
  });

  it('refuses a day that is merely misspelled and a day that never happened', async () => {
    const f = floor();
    const malformed = await api(f)
      .post('/seasons')
      .send(seasonBody({ startsOn: '09-08-2031' }));
    expect(malformed.status).toBe(400);

    const impossible = await api(f)
      .post('/seasons')
      .send(seasonBody({ startsOn: '2031-02-30' }));
    expect(impossible.status).toBe(409);
  });

  it('keeps points whole and inside their band', async () => {
    const f = floor();
    const fractional = await api(f)
      .post('/seasons')
      .send(seasonBody({ pointsWin: 2.5 }));
    const negative = await api(f)
      .post('/seasons')
      .send(seasonBody({ pointsWin: -1 }));
    const overTheTop = await api(f)
      .post('/seasons')
      .send(seasonBody({ pointsWin: 11 }));
    expect(fractional.status).toBe(400);
    expect(negative.status).toBe(400);
    expect(overTheTop.status).toBe(400);

    const atTheCap = await api(f)
      .post('/seasons')
      .send(seasonBody({ pointsWin: 10 }));
    expect(atTheCap.status).toBe(201);
  });

  it('refuses each required field being left out', async () => {
    const f = floor();
    for (const field of ['name', 'startsOn', 'endsOn', 'registrationClosesOn']) {
      const body = seasonBody() as Record<string, unknown>;
      delete body[field];
      const res = await api(f).post('/seasons').send(body);
      expect(res.status).toBe(400);
    }
  });

  it('refuses a body carrying a field it does not know', async () => {
    const f = floor();
    const res = await api(f)
      .post('/seasons')
      .send(seasonBody({ sponsor: 'Ridgeway Motors' }));
    expect(res.status).toBe(400);
  });

  it('refuses a query on a route that takes no filters', async () => {
    const f = floor();
    const res = await api(f).post('/seasons?dryRun=true').send(seasonBody());
    expect(res.status).toBe(400);
  });

  it('keeps the name inside its length band from both sides', async () => {
    const f = floor();
    const tooShort = await api(f)
      .post('/seasons')
      .send(seasonBody({ name: 'abc' }));
    const atTheFloor = await api(f)
      .post('/seasons')
      .send(seasonBody({ name: 'abcd' }));
    expect(tooShort.status).toBe(400);
    expect(atTheFloor.status).toBe(201);

    const tooLong = await api(f)
      .post('/seasons')
      .send(
        seasonBody({
          name: 'x'.repeat(81),
          startsOn: '2040-08-09',
          endsOn: '2041-05-16',
          registrationClosesOn: '2041-03-31',
        }),
      );
    expect(tooLong.status).toBe(400);
  });
});

describe('reading seasons back', () => {
  it('reads one season', async () => {
    const f = floor();
    const made = await aSeason(f);
    const read = await api(f).get(`/seasons/${made.id}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(made);
  });

  it('answers 404 for a season nobody set up', async () => {
    const f = floor();
    const made = await aSeason(f);
    expect((await api(f).get(`/seasons/${made.id}`)).status).toBe(200);
    expect((await api(f).get('/seasons/9907')).status).toBe(404);
  });

  it('answers the list in a wrapper, newest window first', async () => {
    const f = floor();
    const older = await aSeason(f);
    const newer = await aSeason(f, {
      name: 'Season 2032-33',
      startsOn: '2032-08-08',
      endsOn: '2033-05-15',
      registrationClosesOn: '2033-03-31',
    });
    const res = await api(f).get('/seasons');
    expect(res.status).toBe(200);
    expect(res.body.items.map((s: { id: number }) => s.id)).toEqual([newer.id, older.id]);
  });

  it('narrows the list by status', async () => {
    const f = floor();
    const planning = await aSeason(f);
    const running = await aSeason(f, {
      name: 'Season 2032-33',
      startsOn: '2032-08-08',
      endsOn: '2033-05-15',
      registrationClosesOn: '2033-03-31',
    });
    await api(f).post(`/seasons/${running.id}/open`).send({ openedOn: '2032-08-08' });

    const open = await api(f).get('/seasons?status=running');
    expect(open.body.items.map((s: { id: number }) => s.id)).toEqual([running.id]);
    const waiting = await api(f).get('/seasons?status=planning');
    expect(waiting.body.items.map((s: { id: number }) => s.id)).toEqual([planning.id]);
  });

  it('refuses a filter it does not offer and a status it does not have', async () => {
    const f = floor();
    expect((await api(f).get('/seasons?name=Season')).status).toBe(400);
    expect((await api(f).get('/seasons?status=abandoned')).status).toBe(400);
    expect((await api(f).get('/seasons')).status).toBe(200);
  });

  it('answers an empty list before any season exists', async () => {
    const f = floor();
    const res = await api(f).get('/seasons');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });
});

describe('moving a season through its states', () => {
  it('opens a season and writes the day down', async () => {
    const f = floor();
    const made = await aSeason(f);
    const res = await api(f).post(`/seasons/${made.id}/open`).send({ openedOn: '2031-08-09' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('running');
    expect(res.body.openedOn).toBe('2031-08-09');
    expect(res.body.closedOn).toBe(null);
  });

  it('closes a running season and writes that day down too', async () => {
    const f = floor();
    const made = await aSeason(f);
    await api(f).post(`/seasons/${made.id}/open`).send({ openedOn: '2031-08-09' });
    const res = await api(f).post(`/seasons/${made.id}/close`).send({ closedOn: '2032-05-16' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
    expect(res.body.closedOn).toBe('2032-05-16');
    expect(res.body.openedOn).toBe('2031-08-09');
  });

  it('refuses every transition the season is not standing at', async () => {
    const f = floor();
    const made = await aSeason(f);
    const closeFirst = await api(f)
      .post(`/seasons/${made.id}/close`)
      .send({ closedOn: '2032-05-16' });
    expect(closeFirst.status).toBe(409);

    await api(f).post(`/seasons/${made.id}/open`).send({ openedOn: '2031-08-09' });
    const openTwice = await api(f)
      .post(`/seasons/${made.id}/open`)
      .send({ openedOn: '2031-08-10' });
    expect(openTwice.status).toBe(409);

    await api(f).post(`/seasons/${made.id}/close`).send({ closedOn: '2032-05-16' });
    const closeTwice = await api(f)
      .post(`/seasons/${made.id}/close`)
      .send({ closedOn: '2032-05-17' });
    expect(closeTwice.status).toBe(409);
  });

  it('will not open before the first day or after the last', async () => {
    const f = floor();
    const made = await aSeason(f);
    const early = await api(f).post(`/seasons/${made.id}/open`).send({ openedOn: '2031-08-08' });
    expect(early.status).toBe(409);
    const late = await api(f).post(`/seasons/${made.id}/open`).send({ openedOn: '2032-05-17' });
    expect(late.status).toBe(409);
  });

  it('will not close before the day it opened', async () => {
    const f = floor();
    const made = await aSeason(f);
    await api(f).post(`/seasons/${made.id}/open`).send({ openedOn: '2031-09-01' });
    const res = await api(f).post(`/seasons/${made.id}/close`).send({ closedOn: '2031-08-31' });
    expect(res.status).toBe(409);
  });

  it('refuses an impossible day on each transition', async () => {
    const f = floor();
    const made = await aSeason(f);
    const openBad = await api(f).post(`/seasons/${made.id}/open`).send({ openedOn: '2031-11-31' });
    expect(openBad.status).toBe(409);

    await api(f).post(`/seasons/${made.id}/open`).send({ openedOn: '2031-08-09' });
    const closeBad = await api(f)
      .post(`/seasons/${made.id}/close`)
      .send({ closedOn: '2032-02-30' });
    expect(closeBad.status).toBe(409);
  });

  it('refuses a malformed day on each transition', async () => {
    const f = floor();
    const made = await aSeason(f);
    expect(
      (await api(f).post(`/seasons/${made.id}/open`).send({ openedOn: '9/8/31' })).status,
    ).toBe(400);
    await api(f).post(`/seasons/${made.id}/open`).send({ openedOn: '2031-08-09' });
    expect(
      (await api(f).post(`/seasons/${made.id}/close`).send({ closedOn: 'May 16th' })).status,
    ).toBe(400);
  });

  it('answers 404 when the season being moved does not exist', async () => {
    const f = floor();
    const made = await aSeason(f);
    expect(
      (await api(f).post(`/seasons/${made.id}/open`).send({ openedOn: '2031-08-09' })).status,
    ).toBe(200);
    expect((await api(f).post('/seasons/9907/open').send({ openedOn: '2031-08-09' })).status).toBe(
      404,
    );
    expect((await api(f).post('/seasons/9907/close').send({ closedOn: '2032-05-16' })).status).toBe(
      404,
    );
  });

  it('refuses a transition body that names the wrong day field', async () => {
    const f = floor();
    const made = await aSeason(f);
    const res = await api(f).post(`/seasons/${made.id}/open`).send({ closedOn: '2031-08-09' });
    expect(res.status).toBe(400);
  });
});

describe('changing a season that is already set up', () => {
  it('changes what it is told to and leaves the rest alone', async () => {
    const f = floor();
    const made = await aSeason(f);
    const res = await api(f).patch(`/seasons/${made.id}`).send({ name: 'Season 2031-32 renamed' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Season 2031-32 renamed');
    expect(res.body.startsOn).toBe(made.startsOn);
    expect(res.body.endsOn).toBe(made.endsOn);
  });

  it('refuses a change that names nothing to change', async () => {
    const f = floor();
    const made = await aSeason(f);
    expect((await api(f).patch(`/seasons/${made.id}`).send({})).status).toBe(400);
  });

  it('will not move the last day before the first', async () => {
    const f = floor();
    const made = await aSeason(f);
    const res = await api(f).patch(`/seasons/${made.id}`).send({ endsOn: '2031-08-08' });
    expect(res.status).toBe(409);
  });

  it('will not let registration fall outside the new window', async () => {
    const f = floor();
    const made = await aSeason(f);
    const res = await api(f).patch(`/seasons/${made.id}`).send({ endsOn: '2032-03-30' });
    expect(res.status).toBe(409);
  });

  it('refuses a day that never happened on each day it lets you change', async () => {
    const f = floor();
    const made = await aSeason(f);
    expect((await api(f).patch(`/seasons/${made.id}`).send({ endsOn: '2032-02-30' })).status).toBe(
      409,
    );
    expect(
      (await api(f).patch(`/seasons/${made.id}`).send({ registrationClosesOn: '2032-02-30' }))
        .status,
    ).toBe(409);
  });

  it('will not change a season that has been closed', async () => {
    const f = floor();
    const made = await aSeason(f);
    await api(f).post(`/seasons/${made.id}/open`).send({ openedOn: '2031-08-09' });
    await api(f).post(`/seasons/${made.id}/close`).send({ closedOn: '2032-05-16' });
    const res = await api(f).patch(`/seasons/${made.id}`).send({ name: 'Season 2031-32 again' });
    expect(res.status).toBe(409);
  });

  it('refuses the start day being moved, which is not offered', async () => {
    const f = floor();
    const made = await aSeason(f);
    const res = await api(f).patch(`/seasons/${made.id}`).send({ startsOn: '2031-08-10' });
    expect(res.status).toBe(400);
  });
});

describe('who may settle a season', () => {
  it('needs a token on every season route', async () => {
    const f = floor();
    const made = await aSeason(f);
    expect((await bare(f).post('/seasons').send(seasonBody())).status).toBe(401);
    expect((await bare(f).get('/seasons')).status).toBe(401);
    expect((await bare(f).get(`/seasons/${made.id}`)).status).toBe(401);
    expect((await bare(f).patch(`/seasons/${made.id}`).send({ name: 'Nope at all' })).status).toBe(
      401,
    );
    expect(
      (await bare(f).post(`/seasons/${made.id}/open`).send({ openedOn: '2031-08-09' })).status,
    ).toBe(401);
    expect(
      (await bare(f).post(`/seasons/${made.id}/close`).send({ closedOn: '2032-05-16' })).status,
    ).toBe(401);
  });

  it('lets a registrar read a season but not set one up', async () => {
    const f = floor();
    const token = staffWith(f, 'registrar', 'reg-season@touchline.example');
    expect((await api(f, token).get('/seasons')).status).toBe(200);
    const write = await api(f, token).post('/seasons').send(seasonBody());
    expect(write.status).toBe(409);
  });
});

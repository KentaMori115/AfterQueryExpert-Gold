import {
  aDivision,
  aSeason,
  api,
  bare,
  floor,
  staffWith,
  type Floor,
} from '../../../tests/helpers';

function divisionBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Premier Division',
    tier: 1,
    teamCapacity: 10,
    promotionPlaces: 0,
    relegationPlaces: 2,
    ...overrides,
  };
}

async function seasonAndDivision(f: Floor, overrides: Record<string, unknown> = {}) {
  const season = await aSeason(f);
  const division = await aDivision(f, season.id, overrides);
  return { season, division };
}

describe('forming a division inside a season', () => {
  it('answers the whole shape back, forming and unfixed', async () => {
    const f = floor();
    const season = await aSeason(f);
    const res = await api(f).post(`/seasons/${season.id}/divisions`).send(divisionBody());
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual([
      'completedOn',
      'createdAt',
      'fixedOn',
      'id',
      'name',
      'promotionPlaces',
      'relegationPlaces',
      'seasonId',
      'status',
      'teamCapacity',
      'tier',
      'updatedAt',
    ]);
    expect(res.body.seasonId).toBe(season.id);
    expect(res.body.status).toBe('forming');
    expect(res.body.fixedOn).toBe(null);
    expect(res.body.completedOn).toBe(null);
  });

  it('holds one division per tier and one per name in a season', async () => {
    const f = floor();
    const { season } = await seasonAndDivision(f);
    const sameTier = await api(f)
      .post(`/seasons/${season.id}/divisions`)
      .send(divisionBody({ name: 'Championship' }));
    expect(sameTier.status).toBe(409);

    const sameName = await api(f)
      .post(`/seasons/${season.id}/divisions`)
      .send(divisionBody({ tier: 2 }));
    expect(sameName.status).toBe(409);

    const clear = await api(f)
      .post(`/seasons/${season.id}/divisions`)
      .send(divisionBody({ name: 'Championship', tier: 2 }));
    expect(clear.status).toBe(201);
  });

  it('lets another season reuse the same tier and name', async () => {
    const f = floor();
    await seasonAndDivision(f);
    const other = await aSeason(f, {
      name: 'Season 2032-33',
      startsOn: '2032-08-08',
      endsOn: '2033-05-15',
      registrationClosesOn: '2033-03-31',
    });
    const res = await api(f).post(`/seasons/${other.id}/divisions`).send(divisionBody());
    expect(res.status).toBe(201);
  });

  it('refuses places going up and down that leave nobody where they started', async () => {
    const f = floor();
    const season = await aSeason(f);
    const tooMany = await api(f)
      .post(`/seasons/${season.id}/divisions`)
      .send(divisionBody({ teamCapacity: 4, promotionPlaces: 2, relegationPlaces: 2 }));
    expect(tooMany.status).toBe(409);

    const justEnough = await api(f)
      .post(`/seasons/${season.id}/divisions`)
      .send(divisionBody({ teamCapacity: 4, promotionPlaces: 2, relegationPlaces: 1 }));
    expect(justEnough.status).toBe(201);
  });

  it('keeps the tier inside its band from both sides', async () => {
    const f = floor();
    const season = await aSeason(f);
    expect(
      (
        await api(f)
          .post(`/seasons/${season.id}/divisions`)
          .send(divisionBody({ tier: 0 }))
      ).status,
    ).toBe(400);
    expect(
      (
        await api(f)
          .post(`/seasons/${season.id}/divisions`)
          .send(divisionBody({ tier: 9 }))
      ).status,
    ).toBe(400);
    expect(
      (
        await api(f)
          .post(`/seasons/${season.id}/divisions`)
          .send(divisionBody({ tier: 8 }))
      ).status,
    ).toBe(201);
  });

  it('keeps the capacity whole and inside its band from both sides', async () => {
    const f = floor();
    const season = await aSeason(f);
    for (const capacity of [3, 25, 10.5]) {
      const res = await api(f)
        .post(`/seasons/${season.id}/divisions`)
        .send(divisionBody({ teamCapacity: capacity }));
      expect(res.status).toBe(400);
    }
    expect(
      (
        await api(f)
          .post(`/seasons/${season.id}/divisions`)
          .send(divisionBody({ teamCapacity: 4, relegationPlaces: 1 }))
      ).status,
    ).toBe(201);
  });

  it('refuses a division in a season that has closed', async () => {
    const f = floor();
    const season = await aSeason(f);
    await api(f).post(`/seasons/${season.id}/open`).send({ openedOn: '2031-08-09' });
    await api(f).post(`/seasons/${season.id}/close`).send({ closedOn: '2032-05-16' });
    const res = await api(f).post(`/seasons/${season.id}/divisions`).send(divisionBody());
    expect(res.status).toBe(409);
  });

  it('answers 404 when the season does not exist', async () => {
    const f = floor();
    const season = await aSeason(f);
    expect((await api(f).post(`/seasons/${season.id}/divisions`).send(divisionBody())).status).toBe(
      201,
    );
    expect((await api(f).post('/seasons/9907/divisions').send(divisionBody())).status).toBe(404);
  });

  it('refuses each required field being left out', async () => {
    const f = floor();
    const season = await aSeason(f);
    for (const field of ['name', 'tier', 'teamCapacity', 'promotionPlaces', 'relegationPlaces']) {
      const body = divisionBody() as Record<string, unknown>;
      delete body[field];
      expect((await api(f).post(`/seasons/${season.id}/divisions`).send(body)).status).toBe(400);
    }
  });

  it('refuses a body carrying a field it does not know', async () => {
    const f = floor();
    const season = await aSeason(f);
    const res = await api(f)
      .post(`/seasons/${season.id}/divisions`)
      .send(divisionBody({ sponsor: 'Ridgeway Motors' }));
    expect(res.status).toBe(400);
  });

  it('refuses a query on a route that takes no filters', async () => {
    const f = floor();
    const season = await aSeason(f);
    expect(
      (await api(f).post(`/seasons/${season.id}/divisions?copyFrom=1`).send(divisionBody())).status,
    ).toBe(400);
  });
});

describe('reading divisions back', () => {
  it('reads one division', async () => {
    const f = floor();
    const { division } = await seasonAndDivision(f);
    const read = await api(f).get(`/divisions/${division.id}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(division);
  });

  it('answers 404 for a division nobody formed', async () => {
    const f = floor();
    const { division } = await seasonAndDivision(f);
    expect((await api(f).get(`/divisions/${division.id}`)).status).toBe(200);
    expect((await api(f).get('/divisions/9907')).status).toBe(404);
  });

  it('answers both lists in a wrapper, top tier first', async () => {
    const f = floor();
    const season = await aSeason(f);
    const second = await aDivision(f, season.id, { name: 'Championship', tier: 2 });
    const first = await aDivision(f, season.id);

    const forSeason = await api(f).get(`/seasons/${season.id}/divisions`);
    expect(forSeason.status).toBe(200);
    expect(forSeason.body.items.map((d: { id: number }) => d.id)).toEqual([first.id, second.id]);

    const all = await api(f).get('/divisions');
    expect(all.body.items.map((d: { id: number }) => d.id)).toEqual([first.id, second.id]);
  });

  it('narrows both lists by tier and by status', async () => {
    const f = floor();
    const season = await aSeason(f);
    const first = await aDivision(f, season.id);
    await aDivision(f, season.id, { name: 'Championship', tier: 2 });

    const byTier = await api(f).get(`/seasons/${season.id}/divisions?tier=1`);
    expect(byTier.body.items.map((d: { id: number }) => d.id)).toEqual([first.id]);

    await api(f).post(`/divisions/${first.id}/fix`).send({ fixedOn: '2031-08-10' });
    const fixed = await api(f).get('/divisions?status=fixed');
    expect(fixed.body.items.map((d: { id: number }) => d.id)).toEqual([first.id]);
  });

  it('answers 404 when listing the divisions of a season that does not exist', async () => {
    const f = floor();
    const season = await aSeason(f);
    expect((await api(f).get(`/seasons/${season.id}/divisions`)).status).toBe(200);
    expect((await api(f).get('/seasons/9907/divisions')).status).toBe(404);
  });

  it('refuses a filter neither list offers', async () => {
    const f = floor();
    const season = await aSeason(f);
    expect((await api(f).get(`/seasons/${season.id}/divisions?name=Premier`)).status).toBe(400);
    expect((await api(f).get('/divisions?name=Premier')).status).toBe(400);
    expect((await api(f).get('/divisions')).status).toBe(200);
  });

  it('answers an empty list for a season with no divisions', async () => {
    const f = floor();
    const season = await aSeason(f);
    expect((await api(f).get(`/seasons/${season.id}/divisions`)).body).toEqual({ items: [] });
  });
});

describe('fixing and completing a division', () => {
  it('fixes the entries and writes the day down', async () => {
    const f = floor();
    const { division } = await seasonAndDivision(f);
    const res = await api(f).post(`/divisions/${division.id}/fix`).send({ fixedOn: '2031-08-10' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('fixed');
    expect(res.body.fixedOn).toBe('2031-08-10');
  });

  it('completes a fixed division and keeps the day it was fixed', async () => {
    const f = floor();
    const { division } = await seasonAndDivision(f);
    await api(f).post(`/divisions/${division.id}/fix`).send({ fixedOn: '2031-08-10' });
    const res = await api(f)
      .post(`/divisions/${division.id}/complete`)
      .send({ completedOn: '2032-05-16' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.completedOn).toBe('2032-05-16');
    expect(res.body.fixedOn).toBe('2031-08-10');
  });

  it('refuses every transition the division is not standing at', async () => {
    const f = floor();
    const { division } = await seasonAndDivision(f);
    expect(
      (await api(f).post(`/divisions/${division.id}/complete`).send({ completedOn: '2032-05-16' }))
        .status,
    ).toBe(409);

    await api(f).post(`/divisions/${division.id}/fix`).send({ fixedOn: '2031-08-10' });
    expect(
      (await api(f).post(`/divisions/${division.id}/fix`).send({ fixedOn: '2031-08-11' })).status,
    ).toBe(409);

    await api(f).post(`/divisions/${division.id}/complete`).send({ completedOn: '2032-05-16' });
    expect(
      (await api(f).post(`/divisions/${division.id}/complete`).send({ completedOn: '2032-05-17' }))
        .status,
    ).toBe(409);
  });

  it('will not fix entries before the season starts', async () => {
    const f = floor();
    const { division } = await seasonAndDivision(f);
    const res = await api(f).post(`/divisions/${division.id}/fix`).send({ fixedOn: '2031-08-08' });
    expect(res.status).toBe(409);
  });

  it('will not complete a division before its entries were fixed', async () => {
    const f = floor();
    const { division } = await seasonAndDivision(f);
    await api(f).post(`/divisions/${division.id}/fix`).send({ fixedOn: '2031-09-01' });
    const res = await api(f)
      .post(`/divisions/${division.id}/complete`)
      .send({ completedOn: '2031-08-31' });
    expect(res.status).toBe(409);
  });

  it('refuses a malformed day and one that never happened on each transition', async () => {
    const f = floor();
    const { division } = await seasonAndDivision(f);
    expect(
      (await api(f).post(`/divisions/${division.id}/fix`).send({ fixedOn: '10-08-2031' })).status,
    ).toBe(400);
    expect(
      (await api(f).post(`/divisions/${division.id}/fix`).send({ fixedOn: '2031-09-31' })).status,
    ).toBe(409);

    await api(f).post(`/divisions/${division.id}/fix`).send({ fixedOn: '2031-08-10' });
    expect(
      (await api(f).post(`/divisions/${division.id}/complete`).send({ completedOn: '2032-02-30' }))
        .status,
    ).toBe(409);
  });

  it('refuses a transition body that names the wrong day field', async () => {
    const f = floor();
    const { division } = await seasonAndDivision(f);
    expect(
      (await api(f).post(`/divisions/${division.id}/fix`).send({ completedOn: '2031-08-10' }))
        .status,
    ).toBe(400);
  });

  it('answers 404 on each transition when the division does not exist', async () => {
    const f = floor();
    expect((await api(f).post('/divisions/9907/fix').send({ fixedOn: '2031-08-10' })).status).toBe(
      404,
    );
    expect(
      (await api(f).post('/divisions/9907/complete').send({ completedOn: '2032-05-16' })).status,
    ).toBe(404);
  });
});

describe('changing a division', () => {
  it('changes what it is told to and leaves the rest alone', async () => {
    const f = floor();
    const { division } = await seasonAndDivision(f);
    const res = await api(f)
      .patch(`/divisions/${division.id}`)
      .send({ name: 'Premier Division North' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Premier Division North');
    expect(res.body.tier).toBe(division.tier);
    expect(res.body.teamCapacity).toBe(division.teamCapacity);
  });

  it('refuses a change that names nothing to change', async () => {
    const f = floor();
    const { division } = await seasonAndDivision(f);
    expect((await api(f).patch(`/divisions/${division.id}`).send({})).status).toBe(400);
  });

  it('refuses moving a division to another tier, which is not offered', async () => {
    const f = floor();
    const { division } = await seasonAndDivision(f);
    expect((await api(f).patch(`/divisions/${division.id}`).send({ tier: 2 })).status).toBe(400);
  });

  it('checks the places again against the capacity being changed', async () => {
    const f = floor();
    const { division } = await seasonAndDivision(f);
    const res = await api(f).patch(`/divisions/${division.id}`).send({ teamCapacity: 4 });
    expect(res.status).toBe(200);
    const tooTight = await api(f)
      .patch(`/divisions/${division.id}`)
      .send({ promotionPlaces: 2, relegationPlaces: 2 });
    expect(tooTight.status).toBe(409);
  });

  it('stops changing once the entries are fixed', async () => {
    const f = floor();
    const { division } = await seasonAndDivision(f);
    await api(f).post(`/divisions/${division.id}/fix`).send({ fixedOn: '2031-08-10' });
    expect(
      (await api(f).patch(`/divisions/${division.id}`).send({ name: 'Premier North' })).status,
    ).toBe(409);
  });

  it('refuses renaming a division onto another in the same season', async () => {
    const f = floor();
    const season = await aSeason(f);
    await aDivision(f, season.id);
    const second = await aDivision(f, season.id, { name: 'Championship', tier: 2 });
    expect(
      (await api(f).patch(`/divisions/${second.id}`).send({ name: 'Premier Division' })).status,
    ).toBe(409);
  });
});

describe('who may settle a division', () => {
  it('needs a token on every division route', async () => {
    const f = floor();
    const { season, division } = await seasonAndDivision(f);
    expect(
      (await bare(f).post(`/seasons/${season.id}/divisions`).send(divisionBody())).status,
    ).toBe(401);
    expect((await bare(f).get(`/seasons/${season.id}/divisions`)).status).toBe(401);
    expect((await bare(f).get('/divisions')).status).toBe(401);
    expect((await bare(f).get(`/divisions/${division.id}`)).status).toBe(401);
    expect((await bare(f).patch(`/divisions/${division.id}`).send({ name: 'Nope' })).status).toBe(
      401,
    );
    expect(
      (await bare(f).post(`/divisions/${division.id}/fix`).send({ fixedOn: '2031-08-10' })).status,
    ).toBe(401);
    expect(
      (await bare(f).post(`/divisions/${division.id}/complete`).send({ completedOn: '2032-05-16' }))
        .status,
    ).toBe(401);
  });

  it('lets a registrar read a division but not form one', async () => {
    const f = floor();
    const season = await aSeason(f);
    const token = staffWith(f, 'registrar', 'reg-div@touchline.example');
    expect((await api(f, token).get('/divisions')).status).toBe(200);
    expect(
      (await api(f, token).post(`/seasons/${season.id}/divisions`).send(divisionBody())).status,
    ).toBe(409);
  });
});

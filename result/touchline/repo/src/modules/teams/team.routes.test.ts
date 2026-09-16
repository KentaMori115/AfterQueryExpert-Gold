import {
  aClub,
  aDivision,
  aMemberClub,
  aSeason,
  aTeam,
  api,
  bare,
  floor,
  memberClubs,
  staffWith,
  type Floor,
} from '../../../tests/helpers';

async function aLeague(f: Floor, divisionOverrides: Record<string, unknown> = {}) {
  const season = await aSeason(f);
  const division = await aDivision(f, season.id, divisionOverrides);
  const club = await aMemberClub(f);
  return { season, division, club };
}

describe('entering a side into a division', () => {
  it('answers the whole shape back, entered and not withdrawn', async () => {
    const f = floor();
    const { division, club } = await aLeague(f);
    const res = await api(f)
      .post(`/divisions/${division.id}/teams`)
      .send({ clubId: club.id, rank: 'first', enteredOn: '2031-07-15' });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual([
      'clubId',
      'createdAt',
      'divisionId',
      'enteredOn',
      'id',
      'rank',
      'status',
      'updatedAt',
      'withdrawnOn',
    ]);
    expect(res.body.clubId).toBe(club.id);
    expect(res.body.divisionId).toBe(division.id);
    expect(res.body.status).toBe('entered');
    expect(res.body.withdrawnOn).toBe(null);
  });

  it('refuses a club that is not a member', async () => {
    const f = floor();
    const season = await aSeason(f);
    const division = await aDivision(f, season.id);
    const applicant = await aClub(f);
    const res = await api(f)
      .post(`/divisions/${division.id}/teams`)
      .send({ clubId: applicant.id, rank: 'first', enteredOn: '2031-07-15' });
    expect(res.status).toBe(409);

    await api(f).post(`/clubs/${applicant.id}/admit`).send({ admittedOn: '2031-07-01' });
    await api(f).post(`/clubs/${applicant.id}/suspend`).send({ suspendedOn: '2031-07-05' });
    const suspended = await api(f)
      .post(`/divisions/${division.id}/teams`)
      .send({ clubId: applicant.id, rank: 'first', enteredOn: '2031-07-15' });
    expect(suspended.status).toBe(409);
  });

  it('refuses two sides of the same rank in one season', async () => {
    const f = floor();
    const { season, division, club } = await aLeague(f);
    await aTeam(f, division.id, club.id);
    const other = await aDivision(f, season.id, { name: 'Championship', tier: 2 });
    const again = await api(f)
      .post(`/divisions/${other.id}/teams`)
      .send({ clubId: club.id, rank: 'first', enteredOn: '2031-07-16' });
    expect(again.status).toBe(409);
  });

  it('refuses two sides of one club in the same division', async () => {
    const f = floor();
    const { division, club } = await aLeague(f);
    await aTeam(f, division.id, club.id, 'first');
    const reserves = await api(f)
      .post(`/divisions/${division.id}/teams`)
      .send({ clubId: club.id, rank: 'reserves', enteredOn: '2031-07-16' });
    expect(reserves.status).toBe(409);
  });

  it('keeps a senior side above its own junior sides, whichever is entered first', async () => {
    const f = floor();
    const season = await aSeason(f);
    const top = await aDivision(f, season.id);
    const bottom = await aDivision(f, season.id, { name: 'Championship', tier: 2 });
    const club = await aMemberClub(f);

    await aTeam(f, bottom.id, club.id, 'first');
    const reservesAbove = await api(f)
      .post(`/divisions/${top.id}/teams`)
      .send({ clubId: club.id, rank: 'reserves', enteredOn: '2031-07-16' });
    expect(reservesAbove.status).toBe(409);

    const reservesBelow = await api(f)
      .post(`/divisions/${bottom.id}/teams`)
      .send({ clubId: club.id, rank: 'reserves', enteredOn: '2031-07-16' });
    expect(reservesBelow.status).toBe(409);

    const third = await aDivision(f, season.id, { name: 'Division One', tier: 3 });
    const ok = await api(f)
      .post(`/divisions/${third.id}/teams`)
      .send({ clubId: club.id, rank: 'reserves', enteredOn: '2031-07-16' });
    expect(ok.status).toBe(201);
  });

  it('catches a senior side entered after a junior one', async () => {
    const f = floor();
    const season = await aSeason(f);
    const top = await aDivision(f, season.id);
    const bottom = await aDivision(f, season.id, { name: 'Championship', tier: 2 });
    const club = await aMemberClub(f);

    await aTeam(f, top.id, club.id, 'reserves');
    const firstBelow = await api(f)
      .post(`/divisions/${bottom.id}/teams`)
      .send({ clubId: club.id, rank: 'first', enteredOn: '2031-07-16' });
    expect(firstBelow.status).toBe(409);
  });

  it('refuses an entry once the division is full', async () => {
    const f = floor();
    const season = await aSeason(f);
    const division = await aDivision(f, season.id, { teamCapacity: 4, relegationPlaces: 1 });
    const clubs = await memberClubs(f, 5);
    for (const club of clubs.slice(0, 4)) {
      expect((await aTeam(f, division.id, club.id)).id).toBeDefined();
    }
    const fifth = clubs[4];
    const res = await api(f)
      .post(`/divisions/${division.id}/teams`)
      .send({ clubId: fifth?.id, rank: 'first', enteredOn: '2031-07-15' });
    expect(res.status).toBe(409);
  });

  it('refuses an entry once the division has fixed its entries', async () => {
    const f = floor();
    const { division, club } = await aLeague(f);
    await api(f).post(`/divisions/${division.id}/fix`).send({ fixedOn: '2031-08-10' });
    const res = await api(f)
      .post(`/divisions/${division.id}/teams`)
      .send({ clubId: club.id, rank: 'first', enteredOn: '2031-08-11' });
    expect(res.status).toBe(409);
  });

  it('refuses a rank the league does not have', async () => {
    const f = floor();
    const { division, club } = await aLeague(f);
    const res = await api(f)
      .post(`/divisions/${division.id}/teams`)
      .send({ clubId: club.id, rank: 'youth', enteredOn: '2031-07-15' });
    expect(res.status).toBe(400);
  });

  it('refuses a malformed day and one that never happened', async () => {
    const f = floor();
    const { division, club } = await aLeague(f);
    expect(
      (
        await api(f)
          .post(`/divisions/${division.id}/teams`)
          .send({ clubId: club.id, rank: 'first', enteredOn: '15-07-2031' })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(f)
          .post(`/divisions/${division.id}/teams`)
          .send({ clubId: club.id, rank: 'first', enteredOn: '2031-07-32' })
      ).status,
    ).toBe(409);
    expect(
      (
        await api(f)
          .post(`/divisions/${division.id}/teams`)
          .send({ clubId: club.id, rank: 'first', enteredOn: '2031-06-31' })
      ).status,
    ).toBe(409);
  });

  it('refuses each required field being left out', async () => {
    const f = floor();
    const { division, club } = await aLeague(f);
    const full: Record<string, unknown> = {
      clubId: club.id,
      rank: 'first',
      enteredOn: '2031-07-15',
    };
    for (const field of ['clubId', 'rank', 'enteredOn']) {
      const body = { ...full };
      delete body[field];
      expect((await api(f).post(`/divisions/${division.id}/teams`).send(body)).status).toBe(400);
    }
  });

  it('refuses a body carrying a field it does not know', async () => {
    const f = floor();
    const { division, club } = await aLeague(f);
    const res = await api(f)
      .post(`/divisions/${division.id}/teams`)
      .send({ clubId: club.id, rank: 'first', enteredOn: '2031-07-15', kit: 'blue' });
    expect(res.status).toBe(400);
  });

  it('refuses a query on a route that takes no filters', async () => {
    const f = floor();
    const { division, club } = await aLeague(f);
    const res = await api(f)
      .post(`/divisions/${division.id}/teams?force=true`)
      .send({ clubId: club.id, rank: 'first', enteredOn: '2031-07-15' });
    expect(res.status).toBe(400);
  });

  it('answers 404 for a division or a club that does not exist', async () => {
    const f = floor();
    const { division, club } = await aLeague(f);
    expect(
      (
        await api(f)
          .post('/divisions/9907/teams')
          .send({ clubId: club.id, rank: 'first', enteredOn: '2031-07-15' })
      ).status,
    ).toBe(404);
    expect(
      (
        await api(f)
          .post(`/divisions/${division.id}/teams`)
          .send({ clubId: 9907, rank: 'first', enteredOn: '2031-07-15' })
      ).status,
    ).toBe(404);
  });
});

describe('reading sides back', () => {
  it('reads one side', async () => {
    const f = floor();
    const { division, club } = await aLeague(f);
    const team = await aTeam(f, division.id, club.id);
    const read = await api(f).get(`/teams/${team.id}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(team);
  });

  it('answers 404 for a side nobody entered', async () => {
    const f = floor();
    const { division, club } = await aLeague(f);
    const team = await aTeam(f, division.id, club.id);
    expect((await api(f).get(`/teams/${team.id}`)).status).toBe(200);
    expect((await api(f).get('/teams/9907')).status).toBe(404);
  });

  it('answers both lists in a wrapper, by club then rank then id', async () => {
    const f = floor();
    const season = await aSeason(f);
    const division = await aDivision(f, season.id);
    const clubs = await memberClubs(f, 2);
    const second = await aTeam(f, division.id, clubs[1]?.id ?? 0);
    const first = await aTeam(f, division.id, clubs[0]?.id ?? 0);

    const forDivision = await api(f).get(`/divisions/${division.id}/teams`);
    expect(forDivision.status).toBe(200);
    expect(forDivision.body.items.map((t: { id: number }) => t.id)).toEqual([first.id, second.id]);

    const all = await api(f).get('/teams');
    expect(all.body.items.map((t: { id: number }) => t.id)).toEqual([first.id, second.id]);
  });

  it('narrows both lists by club, rank and status', async () => {
    const f = floor();
    const season = await aSeason(f);
    const division = await aDivision(f, season.id);
    const clubs = await memberClubs(f, 2);
    const kept = await aTeam(f, division.id, clubs[0]?.id ?? 0);
    const gone = await aTeam(f, division.id, clubs[1]?.id ?? 0);
    await api(f).post(`/teams/${gone.id}/withdraw`).send({ withdrawnOn: '2031-09-01' });

    const byClub = await api(f).get(`/teams?clubId=${clubs[0]?.id}`);
    expect(byClub.body.items.map((t: { id: number }) => t.id)).toEqual([kept.id]);

    const standing = await api(f).get(`/divisions/${division.id}/teams?status=entered`);
    expect(standing.body.items.map((t: { id: number }) => t.id)).toEqual([kept.id]);

    const byRank = await api(f).get('/teams?rank=reserves');
    expect(byRank.body.items).toEqual([]);
  });

  it('answers 404 when listing against a division or club that does not exist', async () => {
    const f = floor();
    const { division } = await aLeague(f);
    expect((await api(f).get(`/divisions/${division.id}/teams`)).status).toBe(200);
    expect((await api(f).get('/divisions/9907/teams')).status).toBe(404);
    expect((await api(f).get('/teams?clubId=9907')).status).toBe(404);
  });

  it('refuses a filter neither list offers', async () => {
    const f = floor();
    const { division } = await aLeague(f);
    expect((await api(f).get(`/divisions/${division.id}/teams?name=Rovers`)).status).toBe(400);
    expect((await api(f).get('/teams?name=Rovers')).status).toBe(400);
    expect((await api(f).get('/teams')).status).toBe(200);
  });

  it('answers an empty list for a division with no entries', async () => {
    const f = floor();
    const { division } = await aLeague(f);
    expect((await api(f).get(`/divisions/${division.id}/teams`)).body).toEqual({ items: [] });
  });
});

describe('withdrawing and moving a side', () => {
  it('withdraws a side and writes the day down', async () => {
    const f = floor();
    const { division, club } = await aLeague(f);
    const team = await aTeam(f, division.id, club.id);
    const res = await api(f).post(`/teams/${team.id}/withdraw`).send({ withdrawnOn: '2031-09-01' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('withdrawn');
    expect(res.body.withdrawnOn).toBe('2031-09-01');
  });

  it('refuses withdrawing twice and withdrawing before the side entered', async () => {
    const f = floor();
    const { division, club } = await aLeague(f);
    const team = await aTeam(f, division.id, club.id);
    expect(
      (await api(f).post(`/teams/${team.id}/withdraw`).send({ withdrawnOn: '2031-07-14' })).status,
    ).toBe(409);
    await api(f).post(`/teams/${team.id}/withdraw`).send({ withdrawnOn: '2031-09-01' });
    expect(
      (await api(f).post(`/teams/${team.id}/withdraw`).send({ withdrawnOn: '2031-09-02' })).status,
    ).toBe(409);
  });

  it('refuses a day that never happened when a side withdraws', async () => {
    const f = floor();
    const { division, club } = await aLeague(f);
    const team = await aTeam(f, division.id, club.id);
    expect(
      (await api(f).post(`/teams/${team.id}/withdraw`).send({ withdrawnOn: '2031-09-31' })).status,
    ).toBe(409);
  });

  it('frees a place in a full division when a side withdraws', async () => {
    const f = floor();
    const season = await aSeason(f);
    const division = await aDivision(f, season.id, { teamCapacity: 4, relegationPlaces: 1 });
    const clubs = await memberClubs(f, 5);
    const entered = [];
    for (const club of clubs.slice(0, 4)) entered.push(await aTeam(f, division.id, club.id));
    await api(f).post(`/teams/${entered[0]?.id}/withdraw`).send({ withdrawnOn: '2031-08-01' });
    const res = await api(f)
      .post(`/divisions/${division.id}/teams`)
      .send({ clubId: clubs[4]?.id, rank: 'first', enteredOn: '2031-08-02' });
    expect(res.status).toBe(201);
  });

  it('moves a side to another division in the same season', async () => {
    const f = floor();
    const season = await aSeason(f);
    const top = await aDivision(f, season.id);
    const bottom = await aDivision(f, season.id, { name: 'Championship', tier: 2 });
    const club = await aMemberClub(f);
    const team = await aTeam(f, top.id, club.id);

    const res = await api(f).post(`/teams/${team.id}/move`).send({ divisionId: bottom.id });
    expect(res.status).toBe(200);
    expect(res.body.divisionId).toBe(bottom.id);
  });

  it('refuses a move to the division it is already in', async () => {
    const f = floor();
    const { division, club } = await aLeague(f);
    const team = await aTeam(f, division.id, club.id);
    expect(
      (await api(f).post(`/teams/${team.id}/move`).send({ divisionId: division.id })).status,
    ).toBe(409);
  });

  it('refuses a move into another season and a move of a withdrawn side', async () => {
    const f = floor();
    const season = await aSeason(f);
    const division = await aDivision(f, season.id);
    const other = await aSeason(f, {
      name: 'Season 2032-33',
      startsOn: '2032-08-08',
      endsOn: '2033-05-15',
      registrationClosesOn: '2033-03-31',
    });
    const elsewhere = await aDivision(f, other.id);
    const club = await aMemberClub(f);
    const team = await aTeam(f, division.id, club.id);

    expect(
      (await api(f).post(`/teams/${team.id}/move`).send({ divisionId: elsewhere.id })).status,
    ).toBe(409);

    await api(f).post(`/teams/${team.id}/withdraw`).send({ withdrawnOn: '2031-09-01' });
    const second = await aDivision(f, season.id, { name: 'Championship', tier: 2 });
    expect(
      (await api(f).post(`/teams/${team.id}/move`).send({ divisionId: second.id })).status,
    ).toBe(409);
  });

  it('refuses a move once either division has fixed its entries', async () => {
    const f = floor();
    const season = await aSeason(f);
    const top = await aDivision(f, season.id);
    const bottom = await aDivision(f, season.id, { name: 'Championship', tier: 2 });
    const club = await aMemberClub(f);
    const team = await aTeam(f, top.id, club.id);
    await api(f).post(`/divisions/${bottom.id}/fix`).send({ fixedOn: '2031-08-10' });
    expect(
      (await api(f).post(`/teams/${team.id}/move`).send({ divisionId: bottom.id })).status,
    ).toBe(409);
  });

  it('checks seniority again when a side moves', async () => {
    const f = floor();
    const season = await aSeason(f);
    const top = await aDivision(f, season.id);
    const middle = await aDivision(f, season.id, { name: 'Championship', tier: 2 });
    const bottom = await aDivision(f, season.id, { name: 'Division One', tier: 3 });
    const club = await aMemberClub(f);
    await aTeam(f, middle.id, club.id, 'first');
    const reserves = await aTeam(f, bottom.id, club.id, 'reserves');

    expect(
      (await api(f).post(`/teams/${reserves.id}/move`).send({ divisionId: top.id })).status,
    ).toBe(409);
  });

  it('answers 404 when the side or the target division does not exist', async () => {
    const f = floor();
    const season = await aSeason(f);
    const division = await aDivision(f, season.id);
    const club = await aMemberClub(f);
    const team = await aTeam(f, division.id, club.id);
    expect(
      (await api(f).post('/teams/9907/withdraw').send({ withdrawnOn: '2031-09-01' })).status,
    ).toBe(404);
    expect((await api(f).post(`/teams/${team.id}/move`).send({ divisionId: 9907 })).status).toBe(
      404,
    );
  });

  it('refuses a transition body that names the wrong field', async () => {
    const f = floor();
    const { division, club } = await aLeague(f);
    const team = await aTeam(f, division.id, club.id);
    expect(
      (await api(f).post(`/teams/${team.id}/withdraw`).send({ leftOn: '2031-09-01' })).status,
    ).toBe(400);
    expect((await api(f).post(`/teams/${team.id}/move`).send({ tier: 2 })).status).toBe(400);
  });
});

describe('who may settle a side', () => {
  it('needs a token on every team route', async () => {
    const f = floor();
    const { division, club } = await aLeague(f);
    const team = await aTeam(f, division.id, club.id);
    expect(
      (
        await bare(f)
          .post(`/divisions/${division.id}/teams`)
          .send({ clubId: club.id, rank: 'reserves', enteredOn: '2031-07-15' })
      ).status,
    ).toBe(401);
    expect((await bare(f).get(`/divisions/${division.id}/teams`)).status).toBe(401);
    expect((await bare(f).get('/teams')).status).toBe(401);
    expect((await bare(f).get(`/teams/${team.id}`)).status).toBe(401);
    expect(
      (await bare(f).post(`/teams/${team.id}/withdraw`).send({ withdrawnOn: '2031-09-01' })).status,
    ).toBe(401);
    expect((await bare(f).post(`/teams/${team.id}/move`).send({ divisionId: 2 })).status).toBe(401);
  });

  it('lets a registrar enter a side but stops a discipline officer', async () => {
    const f = floor();
    const { division, club } = await aLeague(f);
    const registrar = staffWith(f, 'registrar', 'reg-team@touchline.example');
    const officer = staffWith(f, 'discipline', 'disc-team@touchline.example');
    expect(
      (
        await api(f, registrar)
          .post(`/divisions/${division.id}/teams`)
          .send({ clubId: club.id, rank: 'first', enteredOn: '2031-07-15' })
      ).status,
    ).toBe(201);
    expect(
      (
        await api(f, officer)
          .post(`/divisions/${division.id}/teams`)
          .send({ clubId: club.id, rank: 'reserves', enteredOn: '2031-07-15' })
      ).status,
    ).toBe(409);
    expect((await api(f, officer).get('/teams')).status).toBe(200);
  });
});

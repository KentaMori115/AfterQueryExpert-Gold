import {
  aFixedLeague,
  aFixture,
  api,
  bare,
  floor,
  staffWith,
  type Floor,
} from '../../../tests/helpers';

async function aGame(f: Floor) {
  const league = await aFixedLeague(f);
  const home = league.teams[0];
  const away = league.teams[1];
  const fixture = await aFixture(f, league.division.id, home?.id, away?.id, league.venue.id);
  return { ...league, home, away, fixture };
}

async function aReportedGame(f: Floor, overrides: Record<string, unknown> = {}) {
  const game = await aGame(f);
  const res = await api(f)
    .post(`/fixtures/${game.fixture.id}/result`)
    .send({
      homeGoals: 2,
      awayGoals: 1,
      reportedByTeamId: game.home?.id,
      reportedOn: '2031-09-07',
      ...overrides,
    });
  return { ...game, result: res.body };
}

describe('reporting a score', () => {
  it('answers the whole shape back, reported and unanswered', async () => {
    const f = floor();
    const game = await aGame(f);
    const res = await api(f).post(`/fixtures/${game.fixture.id}/result`).send({
      homeGoals: 2,
      awayGoals: 1,
      reportedByTeamId: game.home?.id,
      reportedOn: '2031-09-07',
    });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual([
      'answeredByTeamId',
      'answeredOn',
      'awayGoals',
      'createdAt',
      'fixtureId',
      'homeGoals',
      'id',
      'note',
      'reportedByTeamId',
      'reportedOn',
      'settledOn',
      'status',
      'updatedAt',
    ]);
    expect(res.body.status).toBe('reported');
    expect(res.body.answeredByTeamId).toBe(null);
    expect(res.body.answeredOn).toBe(null);
    expect(res.body.settledOn).toBe(null);
    expect(res.body.note).toBe(null);
  });

  it('leaves the game scheduled until the score is agreed', async () => {
    const f = floor();
    const { fixture } = await aReportedGame(f);
    const read = await api(f).get(`/fixtures/${fixture.id}`);
    expect(read.body.status).toBe('scheduled');
  });

  it('refuses a second report against the same game', async () => {
    const f = floor();
    const { fixture, away } = await aReportedGame(f);
    const again = await api(f)
      .post(`/fixtures/${fixture.id}/result`)
      .send({ homeGoals: 1, awayGoals: 1, reportedByTeamId: away?.id, reportedOn: '2031-09-07' });
    expect(again.status).toBe(409);
  });

  it('refuses a report from a side that did not play', async () => {
    const f = floor();
    const game = await aGame(f);
    const res = await api(f).post(`/fixtures/${game.fixture.id}/result`).send({
      homeGoals: 2,
      awayGoals: 1,
      reportedByTeamId: game.teams[2]?.id,
      reportedOn: '2031-09-07',
    });
    expect(res.status).toBe(409);
  });

  it('refuses a report before the game was played', async () => {
    const f = floor();
    const game = await aGame(f);
    const res = await api(f).post(`/fixtures/${game.fixture.id}/result`).send({
      homeGoals: 2,
      awayGoals: 1,
      reportedByTeamId: game.home?.id,
      reportedOn: '2031-09-05',
    });
    expect(res.status).toBe(409);
  });

  it('refuses a report against a game that was called off or already awarded', async () => {
    const f = floor();
    const game = await aGame(f);
    await api(f).post(`/fixtures/${game.fixture.id}/postpone`).send({ postponedOn: '2031-09-05' });
    const res = await api(f).post(`/fixtures/${game.fixture.id}/result`).send({
      homeGoals: 2,
      awayGoals: 1,
      reportedByTeamId: game.home?.id,
      reportedOn: '2031-09-07',
    });
    expect(res.status).toBe(409);
  });

  it('keeps goals whole and inside their band from both sides', async () => {
    const f = floor();
    const game = await aGame(f);
    const send = (over: Record<string, unknown>) =>
      api(f)
        .post(`/fixtures/${game.fixture.id}/result`)
        .send({
          homeGoals: 2,
          awayGoals: 1,
          reportedByTeamId: game.home?.id,
          reportedOn: '2031-09-07',
          ...over,
        });
    expect((await send({ homeGoals: -1 })).status).toBe(400);
    expect((await send({ homeGoals: 100 })).status).toBe(400);
    expect((await send({ awayGoals: 1.5 })).status).toBe(400);
    expect((await send({ homeGoals: 0, awayGoals: 0 })).status).toBe(201);
  });

  it('refuses each required field being left out', async () => {
    const f = floor();
    const game = await aGame(f);
    const full: Record<string, unknown> = {
      homeGoals: 2,
      awayGoals: 1,
      reportedByTeamId: game.home?.id,
      reportedOn: '2031-09-07',
    };
    for (const field of ['homeGoals', 'awayGoals', 'reportedByTeamId', 'reportedOn']) {
      const body = { ...full };
      delete body[field];
      expect((await api(f).post(`/fixtures/${game.fixture.id}/result`).send(body)).status).toBe(
        400,
      );
    }
  });

  it('refuses a body carrying a field it does not know', async () => {
    const f = floor();
    const game = await aGame(f);
    const res = await api(f)
      .post(`/fixtures/${game.fixture.id}/result`)
      .send({
        homeGoals: 2,
        awayGoals: 1,
        reportedByTeamId: game.home?.id,
        reportedOn: '2031-09-07',
        scorers: ['Tasker'],
      });
    expect(res.status).toBe(400);
  });

  it('refuses a query on a route that takes no filters', async () => {
    const f = floor();
    const game = await aGame(f);
    const res = await api(f).post(`/fixtures/${game.fixture.id}/result?force=true`).send({
      homeGoals: 2,
      awayGoals: 1,
      reportedByTeamId: game.home?.id,
      reportedOn: '2031-09-07',
    });
    expect(res.status).toBe(400);
  });

  it('refuses a malformed day and one that never happened', async () => {
    const f = floor();
    const game = await aGame(f);
    const send = (reportedOn: string) =>
      api(f)
        .post(`/fixtures/${game.fixture.id}/result`)
        .send({ homeGoals: 2, awayGoals: 1, reportedByTeamId: game.home?.id, reportedOn });
    expect((await send('07-09-2031')).status).toBe(400);
    expect((await send('2031-09-31')).status).toBe(409);
  });

  it('answers 404 when the game does not exist', async () => {
    const f = floor();
    const game = await aGame(f);
    const res = await api(f).post('/fixtures/9907/result').send({
      homeGoals: 2,
      awayGoals: 1,
      reportedByTeamId: game.home?.id,
      reportedOn: '2031-09-07',
    });
    expect(res.status).toBe(404);
  });
});

describe('reading scores back', () => {
  it('reads one result by its own id and by the game it belongs to', async () => {
    const f = floor();
    const { result, fixture } = await aReportedGame(f);
    const byId = await api(f).get(`/results/${result.id}`);
    expect(byId.status).toBe(200);
    expect(byId.body).toEqual(result);

    const byFixture = await api(f).get(`/fixtures/${fixture.id}/result`);
    expect(byFixture.status).toBe(200);
    expect(byFixture.body).toEqual(result);
  });

  it('answers 404 for a result nobody reported', async () => {
    const f = floor();
    const game = await aGame(f);
    expect((await api(f).get('/results/9907')).status).toBe(404);
    expect((await api(f).get(`/fixtures/${game.fixture.id}/result`)).status).toBe(404);
    expect((await api(f).get('/fixtures/9907/result')).status).toBe(404);
  });

  it('answers the list in a wrapper, by the day the games were played', async () => {
    const f = floor();
    const league = await aFixedLeague(f);
    const early = await aFixture(
      f,
      league.division.id,
      league.teams[0]?.id,
      league.teams[1]?.id,
      league.venue.id,
      { playedOn: '2031-09-06' },
    );
    const late = await aFixture(
      f,
      league.division.id,
      league.teams[2]?.id,
      league.teams[3]?.id,
      league.venue.id,
      { playedOn: '2031-10-04' },
    );
    const lateResult = await api(f).post(`/fixtures/${late.id}/result`).send({
      homeGoals: 1,
      awayGoals: 1,
      reportedByTeamId: league.teams[2]?.id,
      reportedOn: '2031-10-05',
    });
    const earlyResult = await api(f).post(`/fixtures/${early.id}/result`).send({
      homeGoals: 3,
      awayGoals: 0,
      reportedByTeamId: league.teams[0]?.id,
      reportedOn: '2031-09-07',
    });

    const res = await api(f).get('/results');
    expect(res.status).toBe(200);
    expect(res.body.items.map((r: { id: number }) => r.id)).toEqual([
      earlyResult.body.id,
      lateResult.body.id,
    ]);
  });

  it('narrows the list by division, side and status', async () => {
    const f = floor();
    const { result, division, home, away } = await aReportedGame(f);
    expect(
      (await api(f).get(`/results?divisionId=${division.id}`)).body.items.map(
        (r: { id: number }) => r.id,
      ),
    ).toEqual([result.id]);
    expect(
      (await api(f).get(`/results?teamId=${home?.id}`)).body.items.map((r: { id: number }) => r.id),
    ).toEqual([result.id]);
    expect((await api(f).get('/results?status=confirmed')).body.items).toEqual([]);

    await api(f)
      .post(`/results/${result.id}/confirm`)
      .send({ confirmedByTeamId: away?.id, confirmedOn: '2031-09-08' });
    expect(
      (await api(f).get('/results?status=confirmed')).body.items.map((r: { id: number }) => r.id),
    ).toEqual([result.id]);
  });

  it('refuses a filter the list does not offer', async () => {
    const f = floor();
    await aReportedGame(f);
    expect((await api(f).get('/results?homeGoals=2')).status).toBe(400);
    expect((await api(f).get('/results')).status).toBe(200);
  });

  it('answers an empty list before anything is reported', async () => {
    const f = floor();
    await aFixedLeague(f);
    expect((await api(f).get('/results')).body).toEqual({ items: [] });
  });
});

describe('agreeing or arguing with a score', () => {
  it('confirms a score and marks the game played', async () => {
    const f = floor();
    const { result, away, fixture } = await aReportedGame(f);
    const res = await api(f)
      .post(`/results/${result.id}/confirm`)
      .send({ confirmedByTeamId: away?.id, confirmedOn: '2031-09-08' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmed');
    expect(res.body.answeredByTeamId).toBe(away?.id);
    expect(res.body.answeredOn).toBe('2031-09-08');

    const game = await api(f).get(`/fixtures/${fixture.id}`);
    expect(game.body.status).toBe('played');
  });

  it('refuses the reporting side confirming its own score', async () => {
    const f = floor();
    const { result, home } = await aReportedGame(f);
    const res = await api(f)
      .post(`/results/${result.id}/confirm`)
      .send({ confirmedByTeamId: home?.id, confirmedOn: '2031-09-08' });
    expect(res.status).toBe(409);
  });

  it('refuses a side that did not play answering at all', async () => {
    const f = floor();
    const { result, teams } = await aReportedGame(f);
    expect(
      (
        await api(f)
          .post(`/results/${result.id}/confirm`)
          .send({ confirmedByTeamId: teams[2]?.id, confirmedOn: '2031-09-08' })
      ).status,
    ).toBe(409);
    expect(
      (
        await api(f).post(`/results/${result.id}/dispute`).send({
          disputedByTeamId: teams[2]?.id,
          disputedOn: '2031-09-08',
          note: 'We were not there',
        })
      ).status,
    ).toBe(409);
  });

  it('disputes a score and keeps the game waiting', async () => {
    const f = floor();
    const { result, away, fixture } = await aReportedGame(f);
    const res = await api(f).post(`/results/${result.id}/dispute`).send({
      disputedByTeamId: away?.id,
      disputedOn: '2031-09-08',
      note: 'The second goal was offside and the referee agreed',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('disputed');
    expect(res.body.note).toBe('The second goal was offside and the referee agreed');

    const game = await api(f).get(`/fixtures/${fixture.id}`);
    expect(game.body.status).toBe('scheduled');
  });

  it('will not answer a score before it was reported', async () => {
    const f = floor();
    const { result, away } = await aReportedGame(f);
    expect(
      (
        await api(f)
          .post(`/results/${result.id}/confirm`)
          .send({ confirmedByTeamId: away?.id, confirmedOn: '2031-09-06' })
      ).status,
    ).toBe(409);
  });

  it('refuses every transition the score is not standing at', async () => {
    const f = floor();
    const { result, away } = await aReportedGame(f);
    await api(f)
      .post(`/results/${result.id}/confirm`)
      .send({ confirmedByTeamId: away?.id, confirmedOn: '2031-09-08' });

    expect(
      (
        await api(f)
          .post(`/results/${result.id}/confirm`)
          .send({ confirmedByTeamId: away?.id, confirmedOn: '2031-09-09' })
      ).status,
    ).toBe(409);
    expect(
      (
        await api(f)
          .post(`/results/${result.id}/dispute`)
          .send({ disputedByTeamId: away?.id, disputedOn: '2031-09-09', note: 'Too late now' })
      ).status,
    ).toBe(409);
  });

  it('keeps the note inside its length band from both sides', async () => {
    const f = floor();
    const { result, away } = await aReportedGame(f);
    const send = (note: string) =>
      api(f)
        .post(`/results/${result.id}/dispute`)
        .send({ disputedByTeamId: away?.id, disputedOn: '2031-09-08', note });
    expect((await send('abc')).status).toBe(400);
    expect((await send('x'.repeat(301))).status).toBe(400);
    expect((await send('abcd')).status).toBe(200);
  });

  it('refuses an impossible day on each answer', async () => {
    const f = floor();
    const { result, away } = await aReportedGame(f);
    expect(
      (
        await api(f)
          .post(`/results/${result.id}/confirm`)
          .send({ confirmedByTeamId: away?.id, confirmedOn: '2031-09-31' })
      ).status,
    ).toBe(409);
    expect(
      (
        await api(f)
          .post(`/results/${result.id}/dispute`)
          .send({ disputedByTeamId: away?.id, disputedOn: '2031-02-30', note: 'Wrong day' })
      ).status,
    ).toBe(409);
  });

  it('refuses an answer body naming the wrong field', async () => {
    const f = floor();
    const { result, away } = await aReportedGame(f);
    expect(
      (
        await api(f)
          .post(`/results/${result.id}/confirm`)
          .send({ disputedByTeamId: away?.id, confirmedOn: '2031-09-08' })
      ).status,
    ).toBe(400);
  });

  it('answers 404 on each answer when the result does not exist', async () => {
    const f = floor();
    const { away } = await aReportedGame(f);
    expect(
      (
        await api(f)
          .post('/results/9907/confirm')
          .send({ confirmedByTeamId: away?.id, confirmedOn: '2031-09-08' })
      ).status,
    ).toBe(404);
    expect(
      (
        await api(f)
          .post('/results/9907/dispute')
          .send({ disputedByTeamId: away?.id, disputedOn: '2031-09-08', note: 'Nothing here' })
      ).status,
    ).toBe(404);
  });
});

describe('settling a disputed score', () => {
  it('writes down the score the league decides and marks the game played', async () => {
    const f = floor();
    const { result, away, fixture } = await aReportedGame(f);
    await api(f)
      .post(`/results/${result.id}/dispute`)
      .send({ disputedByTeamId: away?.id, disputedOn: '2031-09-08', note: 'The score was wrong' });

    const res = await api(f)
      .post(`/results/${result.id}/settle`)
      .send({ settledOn: '2031-09-20', homeGoals: 1, awayGoals: 1 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmed');
    expect(res.body.homeGoals).toBe(1);
    expect(res.body.awayGoals).toBe(1);
    expect(res.body.settledOn).toBe('2031-09-20');

    const game = await api(f).get(`/fixtures/${fixture.id}`);
    expect(game.body.status).toBe('played');
  });

  it('refuses settling a score nobody disputed', async () => {
    const f = floor();
    const { result } = await aReportedGame(f);
    const res = await api(f)
      .post(`/results/${result.id}/settle`)
      .send({ settledOn: '2031-09-20', homeGoals: 1, awayGoals: 1 });
    expect(res.status).toBe(409);
  });

  it('will not settle a dispute before it was raised', async () => {
    const f = floor();
    const { result, away } = await aReportedGame(f);
    await api(f)
      .post(`/results/${result.id}/dispute`)
      .send({ disputedByTeamId: away?.id, disputedOn: '2031-09-08', note: 'The score was wrong' });
    const res = await api(f)
      .post(`/results/${result.id}/settle`)
      .send({ settledOn: '2031-09-07', homeGoals: 1, awayGoals: 1 });
    expect(res.status).toBe(409);
  });

  it('refuses a day that never happened when the league settles it', async () => {
    const f = floor();
    const { result, away } = await aReportedGame(f);
    await api(f)
      .post(`/results/${result.id}/dispute`)
      .send({ disputedByTeamId: away?.id, disputedOn: '2031-09-08', note: 'The score was wrong' });
    const res = await api(f)
      .post(`/results/${result.id}/settle`)
      .send({ settledOn: '2031-09-31', homeGoals: 1, awayGoals: 1 });
    expect(res.status).toBe(409);
  });

  it('keeps the settled goals inside their band', async () => {
    const f = floor();
    const { result, away } = await aReportedGame(f);
    await api(f)
      .post(`/results/${result.id}/dispute`)
      .send({ disputedByTeamId: away?.id, disputedOn: '2031-09-08', note: 'The score was wrong' });
    expect(
      (
        await api(f)
          .post(`/results/${result.id}/settle`)
          .send({ settledOn: '2031-09-20', homeGoals: 100, awayGoals: 1 })
      ).status,
    ).toBe(400);
  });

  it('refuses each required field of a settlement being left out', async () => {
    const f = floor();
    const { result, away } = await aReportedGame(f);
    await api(f)
      .post(`/results/${result.id}/dispute`)
      .send({ disputedByTeamId: away?.id, disputedOn: '2031-09-08', note: 'The score was wrong' });
    const full: Record<string, unknown> = { settledOn: '2031-09-20', homeGoals: 1, awayGoals: 1 };
    for (const field of ['settledOn', 'homeGoals', 'awayGoals']) {
      const body = { ...full };
      delete body[field];
      expect((await api(f).post(`/results/${result.id}/settle`).send(body)).status).toBe(400);
    }
  });
});

describe('who may settle a score', () => {
  it('needs a token on every result route', async () => {
    const f = floor();
    const { result, fixture, away } = await aReportedGame(f);
    expect((await bare(f).post(`/fixtures/${fixture.id}/result`).send({})).status).toBe(401);
    expect((await bare(f).get(`/fixtures/${fixture.id}/result`)).status).toBe(401);
    expect((await bare(f).get('/results')).status).toBe(401);
    expect((await bare(f).get(`/results/${result.id}`)).status).toBe(401);
    expect(
      (
        await bare(f)
          .post(`/results/${result.id}/confirm`)
          .send({ confirmedByTeamId: away?.id, confirmedOn: '2031-09-08' })
      ).status,
    ).toBe(401);
    expect((await bare(f).post(`/results/${result.id}/dispute`).send({})).status).toBe(401);
    expect((await bare(f).post(`/results/${result.id}/settle`).send({})).status).toBe(401);
  });

  it('lets a registrar read a score but not report one', async () => {
    const f = floor();
    const game = await aGame(f);
    const token = staffWith(f, 'registrar', 'reg-result@touchline.example');
    expect((await api(f, token).get('/results')).status).toBe(200);
    const write = await api(f, token).post(`/fixtures/${game.fixture.id}/result`).send({
      homeGoals: 2,
      awayGoals: 1,
      reportedByTeamId: game.home?.id,
      reportedOn: '2031-09-07',
    });
    expect(write.status).toBe(409);
  });
});

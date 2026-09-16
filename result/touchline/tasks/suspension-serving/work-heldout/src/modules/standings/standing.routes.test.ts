import { aFixedLeague, aFixture, api, bare, floor, type Floor } from '../../../tests/helpers';

const MATCH_DAYS = ['2031-09-06', '2031-10-04', '2031-11-01', '2031-12-06', '2032-01-10'];

/**
 * Plays one game to a chosen score and gets it agreed, which is the only way a
 * result reaches the table.
 */
async function playedGame(
  f: Floor,
  divisionId: number,
  homeTeamId: number,
  awayTeamId: number,
  venueId: number,
  homeGoals: number,
  awayGoals: number,
  playedOn: string,
  kickOff = '14:00',
) {
  const fixture = await aFixture(f, divisionId, homeTeamId, awayTeamId, venueId, {
    playedOn,
    kickOff,
  });
  const reported = await api(f)
    .post(`/fixtures/${fixture.id}/result`)
    .send({ homeGoals, awayGoals, reportedByTeamId: homeTeamId, reportedOn: playedOn });
  await api(f)
    .post(`/results/${reported.body.id}/confirm`)
    .send({ confirmedByTeamId: awayTeamId, confirmedOn: playedOn });
  return fixture;
}

async function tableFor(f: Floor, divisionId: number, asOf = '2032-05-16') {
  return api(f).get(`/divisions/${divisionId}/table?asOf=${asOf}`);
}

function names(lines: { clubName: string }[]): string[] {
  return lines.map((line) => line.clubName);
}

describe('the shape of a table', () => {
  it('answers the whole reading, not a bare list', async () => {
    const f = floor();
    const { division } = await aFixedLeague(f);
    const res = await tableFor(f, division.id);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'asOf',
      'complete',
      'divisionId',
      'divisionName',
      'goalsScored',
      'lines',
      'outstanding',
      'played',
      'seasonId',
      'tier',
    ]);
    expect(res.body.divisionId).toBe(division.id);
    expect(res.body.tier).toBe(1);
    expect(res.body.asOf).toBe('2032-05-16');
  });

  it('gives every field of a line by value, even before a ball is kicked', async () => {
    const f = floor();
    const { division } = await aFixedLeague(f);
    const res = await tableFor(f, division.id);
    expect(res.body.lines).toHaveLength(4);
    const first = res.body.lines[0];
    expect(Object.keys(first).sort()).toEqual([
      'clubId',
      'clubName',
      'drawn',
      'form',
      'goalDifference',
      'goalsAgainst',
      'goalsFor',
      'lost',
      'placing',
      'played',
      'points',
      'position',
      'rank',
      'shortName',
      'teamId',
      'won',
    ]);
    expect(first.played).toBe(0);
    expect(first.won).toBe(0);
    expect(first.drawn).toBe(0);
    expect(first.lost).toBe(0);
    expect(first.goalsFor).toBe(0);
    expect(first.goalsAgainst).toBe(0);
    expect(first.goalDifference).toBe(0);
    expect(first.points).toBe(0);
    expect(first.form).toBe('');
    expect(first.rank).toBe('first');
  });

  it('counts nothing and calls an empty division incomplete', async () => {
    const f = floor();
    const { division } = await aFixedLeague(f);
    const res = await tableFor(f, division.id);
    expect(res.body.played).toBe(0);
    expect(res.body.outstanding).toBe(0);
    expect(res.body.goalsScored).toBe(0);
    expect(res.body.complete).toBe(false);
  });

  it('orders an untouched division by club name so it is stable', async () => {
    const f = floor();
    const { division } = await aFixedLeague(f);
    const res = await tableFor(f, division.id);
    expect(names(res.body.lines)).toEqual([
      'Ashcroft Town',
      'Brookend United',
      'Ridgeway Rovers',
      'Willow Athletic',
    ]);
  });
});

describe('what a game does to the table', () => {
  it('gives the winner three and the loser none', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    await playedGame(
      f,
      division.id,
      teams[0]?.id,
      teams[1]?.id,
      venue.id,
      3,
      1,
      MATCH_DAYS[0] ?? '',
    );

    const res = await tableFor(f, division.id);
    const winner = res.body.lines.find((l: { teamId: number }) => l.teamId === teams[0]?.id);
    const loser = res.body.lines.find((l: { teamId: number }) => l.teamId === teams[1]?.id);

    expect(winner.played).toBe(1);
    expect(winner.won).toBe(1);
    expect(winner.goalsFor).toBe(3);
    expect(winner.goalsAgainst).toBe(1);
    expect(winner.goalDifference).toBe(2);
    expect(winner.points).toBe(3);
    expect(winner.form).toBe('W');

    expect(loser.lost).toBe(1);
    expect(loser.goalDifference).toBe(-2);
    expect(loser.points).toBe(0);
    expect(loser.form).toBe('L');
  });

  it('gives both sides one for a draw', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    await playedGame(
      f,
      division.id,
      teams[0]?.id,
      teams[1]?.id,
      venue.id,
      2,
      2,
      MATCH_DAYS[0] ?? '',
    );
    const res = await tableFor(f, division.id);
    for (const teamId of [teams[0]?.id, teams[1]?.id]) {
      const line = res.body.lines.find((l: { teamId: number }) => l.teamId === teamId);
      expect(line.drawn).toBe(1);
      expect(line.points).toBe(1);
      expect(line.form).toBe('D');
    }
  });

  it('uses the season own scoring rather than assuming three for a win', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(
      f,
      4,
      {},
      {},
      {
        pointsWin: 4,
        pointsDraw: 2,
        pointsLoss: 1,
      },
    );
    await playedGame(
      f,
      division.id,
      teams[0]?.id,
      teams[1]?.id,
      venue.id,
      1,
      0,
      MATCH_DAYS[0] ?? '',
    );
    await playedGame(
      f,
      division.id,
      teams[2]?.id,
      teams[3]?.id,
      venue.id,
      2,
      2,
      MATCH_DAYS[1] ?? '',
    );

    const res = await tableFor(f, division.id);
    const winner = res.body.lines.find((l: { teamId: number }) => l.teamId === teams[0]?.id);
    const loser = res.body.lines.find((l: { teamId: number }) => l.teamId === teams[1]?.id);
    const drawer = res.body.lines.find((l: { teamId: number }) => l.teamId === teams[2]?.id);

    expect(winner.points).toBe(4);
    expect(drawer.points).toBe(2);
    expect(loser.points).toBe(1);
  });

  it('counts an awarded game with the scoreline its reason carries', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const fixture = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id, {
      playedOn: MATCH_DAYS[0] ?? '',
    });
    await api(f)
      .post(`/fixtures/${fixture.id}/award`)
      .send({ awardedOn: '2031-09-07', awardedToTeamId: teams[1]?.id, reason: 'noShow' });

    const res = await tableFor(f, division.id);
    const winner = res.body.lines.find((l: { teamId: number }) => l.teamId === teams[1]?.id);
    const loser = res.body.lines.find((l: { teamId: number }) => l.teamId === teams[0]?.id);
    expect(winner.points).toBe(3);
    expect(winner.goalsFor).toBe(3);
    expect(winner.goalsAgainst).toBe(0);
    expect(loser.goalsFor).toBe(0);
    expect(loser.goalsAgainst).toBe(3);
    expect(res.body.played).toBe(1);
  });

  it('awards a game called off for an unfit ground more narrowly', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const fixture = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id, {
      playedOn: MATCH_DAYS[0] ?? '',
    });
    await api(f)
      .post(`/fixtures/${fixture.id}/award`)
      .send({ awardedOn: '2031-09-07', awardedToTeamId: teams[0]?.id, reason: 'groundUnfit' });

    const res = await tableFor(f, division.id);
    const winner = res.body.lines.find((l: { teamId: number }) => l.teamId === teams[0]?.id);
    expect(winner.goalsFor).toBe(1);
    expect(winner.goalsAgainst).toBe(0);
    expect(winner.points).toBe(3);
  });

  it('leaves a reported but unagreed score out of the table', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const fixture = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id, {
      playedOn: MATCH_DAYS[0] ?? '',
    });
    await api(f).post(`/fixtures/${fixture.id}/result`).send({
      homeGoals: 5,
      awayGoals: 0,
      reportedByTeamId: teams[0]?.id,
      reportedOn: '2031-09-07',
    });

    const res = await tableFor(f, division.id);
    expect(res.body.played).toBe(0);
    expect(res.body.outstanding).toBe(1);
    expect(res.body.lines.every((l: { played: number }) => l.played === 0)).toBe(true);
  });

  it('counts a disputed score once the league settles it, at the settled figure', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    const fixture = await aFixture(f, division.id, teams[0]?.id, teams[1]?.id, venue.id, {
      playedOn: MATCH_DAYS[0] ?? '',
    });
    const reported = await api(f).post(`/fixtures/${fixture.id}/result`).send({
      homeGoals: 5,
      awayGoals: 0,
      reportedByTeamId: teams[0]?.id,
      reportedOn: '2031-09-07',
    });
    await api(f).post(`/results/${reported.body.id}/dispute`).send({
      disputedByTeamId: teams[1]?.id,
      disputedOn: '2031-09-08',
      note: 'The last two goals were after the whistle',
    });
    await api(f)
      .post(`/results/${reported.body.id}/settle`)
      .send({ settledOn: '2031-09-20', homeGoals: 3, awayGoals: 0 });

    const res = await tableFor(f, division.id);
    const winner = res.body.lines.find((l: { teamId: number }) => l.teamId === teams[0]?.id);
    expect(winner.goalsFor).toBe(3);
    expect(res.body.goalsScored).toBe(3);
  });
});

describe('the order the table reads in', () => {
  it('puts more points above fewer', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    await playedGame(
      f,
      division.id,
      teams[3]?.id,
      teams[2]?.id,
      venue.id,
      1,
      0,
      MATCH_DAYS[0] ?? '',
    );
    const res = await tableFor(f, division.id);
    expect(res.body.lines[0].teamId).toBe(teams[3]?.id);
    expect(res.body.lines[0].position).toBe(1);
  });

  it('separates equal points by goal difference, not by who scored more', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    // Both win once. One wins 5-3, the other 1-0: fewer goals, better difference.
    await playedGame(
      f,
      division.id,
      teams[0]?.id,
      teams[1]?.id,
      venue.id,
      5,
      3,
      MATCH_DAYS[0] ?? '',
    );
    await playedGame(
      f,
      division.id,
      teams[2]?.id,
      teams[3]?.id,
      venue.id,
      1,
      0,
      MATCH_DAYS[1] ?? '',
    );

    const res = await tableFor(f, division.id);
    const top = res.body.lines[0];
    expect(top.teamId).toBe(teams[0]?.id);
    expect(top.goalDifference).toBe(2);
    expect(res.body.lines[1].teamId).toBe(teams[2]?.id);
    expect(res.body.lines[1].goalDifference).toBe(1);
  });

  it('separates equal difference by goals scored', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    // Both win by one. 4-3 outscores 1-0 on goals for.
    await playedGame(
      f,
      division.id,
      teams[3]?.id,
      teams[2]?.id,
      venue.id,
      4,
      3,
      MATCH_DAYS[0] ?? '',
    );
    await playedGame(
      f,
      division.id,
      teams[0]?.id,
      teams[1]?.id,
      venue.id,
      1,
      0,
      MATCH_DAYS[1] ?? '',
    );

    const res = await tableFor(f, division.id);
    expect(res.body.lines[0].teamId).toBe(teams[3]?.id);
    expect(res.body.lines[0].goalsFor).toBe(4);
    expect(res.body.lines[1].teamId).toBe(teams[0]?.id);
  });

  it('separates two sides level on everything by the games between them', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f, 4, { teamCapacity: 10 });
    const a = teams[0]?.id;
    const b = teams[1]?.id;
    const c = teams[2]?.id;
    const d = teams[3]?.id;

    // A and B each beat C and D by the same margin, so points, difference and
    // goals scored all end level. A beat B head to head.
    await playedGame(f, division.id, a, c, venue.id, 2, 0, MATCH_DAYS[0] ?? '');
    await playedGame(f, division.id, b, d, venue.id, 2, 0, MATCH_DAYS[0] ?? '', '11:00');
    await playedGame(f, division.id, a, b, venue.id, 1, 0, MATCH_DAYS[1] ?? '');
    await playedGame(f, division.id, d, c, venue.id, 0, 0, MATCH_DAYS[1] ?? '', '11:00');

    const res = await tableFor(f, division.id);
    const top = res.body.lines[0];
    const second = res.body.lines[1];
    expect(top.points).toBe(6);
    expect(second.points).toBe(3);
    expect(top.teamId).toBe(a);
  });

  it('falls through to the club name when two sides have never met', async () => {
    const f = floor();
    const { division, venue } = await aFixedLeague(f);
    // Willow beats Ridgeway; Brookend beats Ashcroft. The two winners never meet
    // and finish level on points, difference and goals scored.
    const byName = new Map<string, number>();
    const list = await api(f).get(`/divisions/${division.id}/teams`);
    for (const team of list.body.items) {
      const club = await api(f).get(`/clubs/${team.clubId}`);
      byName.set(club.body.name, team.id);
    }
    await playedGame(
      f,
      division.id,
      byName.get('Willow Athletic') ?? 0,
      byName.get('Ridgeway Rovers') ?? 0,
      venue.id,
      1,
      0,
      MATCH_DAYS[0] ?? '',
    );
    await playedGame(
      f,
      division.id,
      byName.get('Brookend United') ?? 0,
      byName.get('Ashcroft Town') ?? 0,
      venue.id,
      1,
      0,
      MATCH_DAYS[0] ?? '',
      '11:00',
    );

    const res = await tableFor(f, division.id);
    expect(names(res.body.lines).slice(0, 2)).toEqual(['Brookend United', 'Willow Athletic']);
  });

  it('numbers the positions from one downwards without gaps', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    await playedGame(
      f,
      division.id,
      teams[0]?.id,
      teams[1]?.id,
      venue.id,
      2,
      0,
      MATCH_DAYS[0] ?? '',
    );
    const res = await tableFor(f, division.id);
    expect(res.body.lines.map((l: { position: number }) => l.position)).toEqual([1, 2, 3, 4]);
  });
});

describe('the table as it stood on a given day', () => {
  it('leaves out games played after the day asked for', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    await playedGame(
      f,
      division.id,
      teams[0]?.id,
      teams[1]?.id,
      venue.id,
      1,
      0,
      MATCH_DAYS[0] ?? '',
    );
    await playedGame(
      f,
      division.id,
      teams[2]?.id,
      teams[3]?.id,
      venue.id,
      4,
      0,
      MATCH_DAYS[2] ?? '',
    );

    const early = await tableFor(f, division.id, '2031-09-30');
    expect(early.body.played).toBe(1);
    expect(early.body.outstanding).toBe(1);
    expect(early.body.lines[0].teamId).toBe(teams[0]?.id);

    const later = await tableFor(f, division.id, '2031-11-30');
    expect(later.body.played).toBe(2);
    expect(later.body.outstanding).toBe(0);
    expect(later.body.lines[0].teamId).toBe(teams[2]?.id);
  });

  it('counts a game played on the day asked for', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    await playedGame(
      f,
      division.id,
      teams[0]?.id,
      teams[1]?.id,
      venue.id,
      1,
      0,
      MATCH_DAYS[0] ?? '',
    );
    const res = await tableFor(f, division.id, MATCH_DAYS[0]);
    expect(res.body.played).toBe(1);
  });

  it('reads the form guide newest first', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f, 4, { teamCapacity: 10 });
    const a = teams[0]?.id;
    await playedGame(f, division.id, a, teams[1]?.id, venue.id, 1, 0, MATCH_DAYS[0] ?? '');
    await playedGame(f, division.id, teams[2]?.id, a, venue.id, 2, 0, MATCH_DAYS[1] ?? '');
    await playedGame(f, division.id, a, teams[3]?.id, venue.id, 1, 1, MATCH_DAYS[2] ?? '');

    const res = await tableFor(f, division.id);
    const line = res.body.lines.find((l: { teamId: number }) => l.teamId === a);
    expect(line.form).toBe('DLW');
  });

  it('calls the division complete only once nothing is outstanding', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f);
    await playedGame(
      f,
      division.id,
      teams[0]?.id,
      teams[1]?.id,
      venue.id,
      1,
      0,
      MATCH_DAYS[0] ?? '',
    );
    await aFixture(f, division.id, teams[2]?.id, teams[3]?.id, venue.id, {
      playedOn: MATCH_DAYS[1] ?? '',
    });

    const midway = await tableFor(f, division.id);
    expect(midway.body.complete).toBe(false);
    expect(midway.body.outstanding).toBe(1);
  });
});

describe('where the table says a side finished', () => {
  it('marks the top for promotion and the bottom for relegation', async () => {
    const f = floor();
    const { division, teams, venue } = await aFixedLeague(f, 4, {
      teamCapacity: 4,
      promotionPlaces: 1,
      relegationPlaces: 1,
    });
    await playedGame(
      f,
      division.id,
      teams[0]?.id,
      teams[1]?.id,
      venue.id,
      3,
      0,
      MATCH_DAYS[0] ?? '',
    );

    const res = await tableFor(f, division.id);
    expect(res.body.lines[0].placing).toBe('promoted');
    expect(res.body.lines[1].placing).toBe('safe');
    expect(res.body.lines[2].placing).toBe('safe');
    expect(res.body.lines[3].placing).toBe('relegated');
  });

  it('marks nobody for promotion when the division gives no places out', async () => {
    const f = floor();
    const { division } = await aFixedLeague(f, 4, {
      teamCapacity: 4,
      promotionPlaces: 0,
      relegationPlaces: 0,
    });
    const res = await tableFor(f, division.id);
    expect(res.body.lines.every((l: { placing: string }) => l.placing === 'safe')).toBe(true);
  });
});

describe('what the table refuses', () => {
  it('leaves a withdrawn side out of the table', async () => {
    const f = floor();
    const { division, teams } = await aFixedLeague(f);
    await api(f).post(`/teams/${teams[3]?.id}/withdraw`).send({ withdrawnOn: '2031-09-01' });
    const res = await tableFor(f, division.id);
    expect(res.body.lines).toHaveLength(3);
    expect(res.body.lines.map((l: { teamId: number }) => l.teamId)).not.toContain(teams[3]?.id);
  });

  it('insists on being told which day to read it for', async () => {
    const f = floor();
    const { division } = await aFixedLeague(f);
    expect((await api(f).get(`/divisions/${division.id}/table`)).status).toBe(400);
  });

  it('refuses a malformed day and one that never happened', async () => {
    const f = floor();
    const { division } = await aFixedLeague(f);
    expect((await api(f).get(`/divisions/${division.id}/table?asOf=06-09-2031`)).status).toBe(400);
    expect((await api(f).get(`/divisions/${division.id}/table?asOf=2031-09-31`)).status).toBe(409);
  });

  it('refuses a day before the season started', async () => {
    const f = floor();
    const { division } = await aFixedLeague(f);
    expect((await api(f).get(`/divisions/${division.id}/table?asOf=2031-08-08`)).status).toBe(409);
  });

  it('refuses a filter it does not offer', async () => {
    const f = floor();
    const { division } = await aFixedLeague(f);
    expect(
      (await api(f).get(`/divisions/${division.id}/table?asOf=2032-05-16&tier=1`)).status,
    ).toBe(400);
  });

  it('answers 404 for a division nobody formed', async () => {
    const f = floor();
    const { division } = await aFixedLeague(f);
    expect((await api(f).get(`/divisions/${division.id}/table?asOf=2032-05-16`)).status).toBe(200);
    expect((await api(f).get('/divisions/9907/table?asOf=2032-05-16')).status).toBe(404);
  });

  it('needs a token', async () => {
    const f = floor();
    const { division } = await aFixedLeague(f);
    expect((await bare(f).get(`/divisions/${division.id}/table?asOf=2032-05-16`)).status).toBe(401);
    expect((await api(f).get(`/divisions/${division.id}/table?asOf=2032-05-16`)).status).toBe(200);
  });
});

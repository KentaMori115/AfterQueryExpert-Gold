import { api, bare, floor, staffWith, type Floor } from '../../../tests/helpers';

function clubBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Ridgeway Rovers',
    shortName: 'RID',
    foundedYear: 1974,
    contactEmail: 'secretary@ridgewayrovers.example',
    appliedOn: '2031-06-01',
    ...overrides,
  };
}

async function aClub(f: Floor, overrides: Record<string, unknown> = {}) {
  const res = await api(f).post('/clubs').send(clubBody(overrides));
  return res.body;
}

async function aMemberClub(f: Floor, overrides: Record<string, unknown> = {}) {
  const club = await aClub(f, overrides);
  await api(f).post(`/clubs/${club.id}/admit`).send({ admittedOn: '2031-07-01' });
  return (await api(f).get(`/clubs/${club.id}`)).body;
}

async function aVenue(f: Floor, overrides: Record<string, unknown> = {}) {
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

describe('taking a club application', () => {
  it('answers the whole shape back, applied and not yet admitted', async () => {
    const f = floor();
    const res = await api(f).post('/clubs').send(clubBody());
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual([
      'admittedOn',
      'appliedOn',
      'contactEmail',
      'createdAt',
      'foundedYear',
      'homeVenueId',
      'id',
      'leftOn',
      'name',
      'shortName',
      'status',
      'updatedAt',
    ]);
    expect(res.body.status).toBe('applied');
    expect(res.body.admittedOn).toBe(null);
    expect(res.body.leftOn).toBe(null);
    expect(res.body.homeVenueId).toBe(null);
  });

  it('squares the scoreboard letters up as it stores them', async () => {
    const f = floor();
    const made = await aClub(f, { shortName: 'rid' });
    expect(made.shortName).toBe('RID');
  });

  it('refuses letters that are too few, too many, or not letters', async () => {
    const f = floor();
    expect(
      (
        await api(f)
          .post('/clubs')
          .send(clubBody({ shortName: 'RI' }))
      ).status,
    ).toBe(400);
    expect(
      (
        await api(f)
          .post('/clubs')
          .send(clubBody({ shortName: 'RIDGE' }))
      ).status,
    ).toBe(400);
    expect(
      (
        await api(f)
          .post('/clubs')
          .send(clubBody({ shortName: 'R1D' }))
      ).status,
    ).toBe(400);
    expect(
      (
        await api(f)
          .post('/clubs')
          .send(clubBody({ shortName: 'RID' }))
      ).status,
    ).toBe(201);
  });

  it('accepts four letters as well as three', async () => {
    const f = floor();
    const made = await aClub(f, { shortName: 'RIDG' });
    expect(made.shortName).toBe('RIDG');
  });

  it('refuses a second club by the same name or the same letters', async () => {
    const f = floor();
    await aClub(f);
    const sameName = await api(f)
      .post('/clubs')
      .send(clubBody({ shortName: 'ROV' }));
    expect(sameName.status).toBe(409);
    const sameLetters = await api(f)
      .post('/clubs')
      .send(clubBody({ name: 'Ridgeway Wanderers' }));
    expect(sameLetters.status).toBe(409);
  });

  it('keeps the founding year inside its band from both sides', async () => {
    const f = floor();
    expect(
      (
        await api(f)
          .post('/clubs')
          .send(clubBody({ foundedYear: 1849 }))
      ).status,
    ).toBe(400);
    expect(
      (
        await api(f)
          .post('/clubs')
          .send(clubBody({ foundedYear: 2101 }))
      ).status,
    ).toBe(400);
    expect(
      (
        await api(f)
          .post('/clubs')
          .send(clubBody({ foundedYear: 1974.5 }))
      ).status,
    ).toBe(400);
    expect(
      (
        await api(f)
          .post('/clubs')
          .send(clubBody({ foundedYear: 1850 }))
      ).status,
    ).toBe(201);
  });

  it('refuses a day that is misspelled and one that never happened', async () => {
    const f = floor();
    expect(
      (
        await api(f)
          .post('/clubs')
          .send(clubBody({ appliedOn: '01-06-2031' }))
      ).status,
    ).toBe(400);
    expect(
      (
        await api(f)
          .post('/clubs')
          .send(clubBody({ appliedOn: '2031-06-31' }))
      ).status,
    ).toBe(409);
  });

  it('takes a home ground and refuses one that is closed or missing', async () => {
    const f = floor();
    const venue = await aVenue(f);
    const withGround = await aClub(f, { homeVenueId: venue.id });
    expect(withGround.homeVenueId).toBe(venue.id);

    const missing = await api(f)
      .post('/clubs')
      .send(clubBody({ name: 'Other Club', shortName: 'OTH', homeVenueId: 9907 }));
    expect(missing.status).toBe(404);

    await api(f).post(`/venues/${venue.id}/close`).send({ closedOn: '2031-11-01' });
    const closed = await api(f)
      .post('/clubs')
      .send(clubBody({ name: 'Third Club', shortName: 'THI', homeVenueId: venue.id }));
    expect(closed.status).toBe(409);
  });

  it('refuses each required field being left out', async () => {
    const f = floor();
    for (const field of ['name', 'shortName', 'foundedYear', 'contactEmail', 'appliedOn']) {
      const body = clubBody() as Record<string, unknown>;
      delete body[field];
      expect((await api(f).post('/clubs').send(body)).status).toBe(400);
    }
  });

  it('refuses a body carrying a field it does not know', async () => {
    const f = floor();
    expect(
      (
        await api(f)
          .post('/clubs')
          .send(clubBody({ nickname: 'The Rovers' }))
      ).status,
    ).toBe(400);
  });

  it('refuses a query on a route that takes no filters', async () => {
    const f = floor();
    expect((await api(f).post('/clubs?notify=true').send(clubBody())).status).toBe(400);
  });

  it('refuses a contact address that is not an address', async () => {
    const f = floor();
    expect(
      (
        await api(f)
          .post('/clubs')
          .send(clubBody({ contactEmail: 'the club' }))
      ).status,
    ).toBe(400);
  });
});

describe('reading clubs back', () => {
  it('reads one club', async () => {
    const f = floor();
    const made = await aClub(f);
    const read = await api(f).get(`/clubs/${made.id}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(made);
  });

  it('answers 404 for a club nobody applied for', async () => {
    const f = floor();
    const made = await aClub(f);
    expect((await api(f).get(`/clubs/${made.id}`)).status).toBe(200);
    expect((await api(f).get('/clubs/9907')).status).toBe(404);
  });

  it('answers the list in a wrapper, by name and then by id', async () => {
    const f = floor();
    await aClub(f, { name: 'Willow Athletic', shortName: 'WIL' });
    await aClub(f, { name: 'Ashcroft Town', shortName: 'ASH' });
    const res = await api(f).get('/clubs');
    expect(res.body.items.map((c: { name: string }) => c.name)).toEqual([
      'Ashcroft Town',
      'Willow Athletic',
    ]);
  });

  it('narrows the list by status and by home ground', async () => {
    const f = floor();
    const venue = await aVenue(f);
    const member = await aMemberClub(f, { homeVenueId: venue.id });
    await aClub(f, { name: 'Willow Athletic', shortName: 'WIL' });

    const members = await api(f).get('/clubs?status=member');
    expect(members.body.items.map((c: { id: number }) => c.id)).toEqual([member.id]);

    const atGround = await api(f).get(`/clubs?homeVenueId=${venue.id}`);
    expect(atGround.body.items.map((c: { id: number }) => c.id)).toEqual([member.id]);
  });

  it('answers 404 when filtering by a ground that does not exist', async () => {
    const f = floor();
    const venue = await aVenue(f);
    expect((await api(f).get(`/clubs?homeVenueId=${venue.id}`)).status).toBe(200);
    expect((await api(f).get('/clubs?homeVenueId=9907')).status).toBe(404);
  });

  it('refuses a filter it does not offer', async () => {
    const f = floor();
    expect((await api(f).get('/clubs?shortName=RID')).status).toBe(400);
    expect((await api(f).get('/clubs')).status).toBe(200);
  });

  it('answers an empty list before any club applies', async () => {
    const f = floor();
    expect((await api(f).get('/clubs')).body).toEqual({ items: [] });
  });
});

describe('moving a club through its standing', () => {
  it('admits an applicant and writes the day down', async () => {
    const f = floor();
    const made = await aClub(f);
    const res = await api(f).post(`/clubs/${made.id}/admit`).send({ admittedOn: '2031-07-01' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('member');
    expect(res.body.admittedOn).toBe('2031-07-01');
  });

  it('suspends a member and reinstates it, keeping the day it was admitted', async () => {
    const f = floor();
    const club = await aMemberClub(f);
    const suspended = await api(f)
      .post(`/clubs/${club.id}/suspend`)
      .send({ suspendedOn: '2031-09-01' });
    expect(suspended.status).toBe(200);
    expect(suspended.body.status).toBe('suspended');

    const back = await api(f)
      .post(`/clubs/${club.id}/reinstate`)
      .send({ reinstatedOn: '2031-10-01' });
    expect(back.status).toBe(200);
    expect(back.body.status).toBe('member');
    expect(back.body.admittedOn).toBe('2031-07-01');
  });

  it('lets a club resign from any standing short of resigned', async () => {
    const f = floor();
    const applicant = await aClub(f);
    const gone = await api(f).post(`/clubs/${applicant.id}/resign`).send({ leftOn: '2031-06-15' });
    expect(gone.status).toBe(200);
    expect(gone.body.status).toBe('resigned');
    expect(gone.body.leftOn).toBe('2031-06-15');

    const again = await api(f).post(`/clubs/${applicant.id}/resign`).send({ leftOn: '2031-06-16' });
    expect(again.status).toBe(409);
  });

  it('refuses every transition the club is not standing at', async () => {
    const f = floor();
    const applicant = await aClub(f);
    expect(
      (await api(f).post(`/clubs/${applicant.id}/suspend`).send({ suspendedOn: '2031-07-01' }))
        .status,
    ).toBe(409);
    expect(
      (await api(f).post(`/clubs/${applicant.id}/reinstate`).send({ reinstatedOn: '2031-07-01' }))
        .status,
    ).toBe(409);

    const member = await aMemberClub(f, { name: 'Willow Athletic', shortName: 'WIL' });
    expect(
      (await api(f).post(`/clubs/${member.id}/admit`).send({ admittedOn: '2031-07-02' })).status,
    ).toBe(409);
    expect(
      (await api(f).post(`/clubs/${member.id}/reinstate`).send({ reinstatedOn: '2031-07-02' }))
        .status,
    ).toBe(409);
  });

  it('will not admit a club before it applied', async () => {
    const f = floor();
    const made = await aClub(f);
    const res = await api(f).post(`/clubs/${made.id}/admit`).send({ admittedOn: '2031-05-31' });
    expect(res.status).toBe(409);
  });

  it('will not suspend or reinstate before the club was admitted', async () => {
    const f = floor();
    const club = await aMemberClub(f);
    expect(
      (await api(f).post(`/clubs/${club.id}/suspend`).send({ suspendedOn: '2031-06-30' })).status,
    ).toBe(409);

    await api(f).post(`/clubs/${club.id}/suspend`).send({ suspendedOn: '2031-09-01' });
    expect(
      (await api(f).post(`/clubs/${club.id}/reinstate`).send({ reinstatedOn: '2031-06-30' }))
        .status,
    ).toBe(409);
  });

  it('will not let a club leave before it applied', async () => {
    const f = floor();
    const made = await aClub(f);
    expect(
      (await api(f).post(`/clubs/${made.id}/resign`).send({ leftOn: '2031-05-31' })).status,
    ).toBe(409);
  });

  it('refuses an impossible day on each transition', async () => {
    const f = floor();
    const made = await aClub(f);
    expect(
      (await api(f).post(`/clubs/${made.id}/admit`).send({ admittedOn: '2031-06-31' })).status,
    ).toBe(409);
    await api(f).post(`/clubs/${made.id}/admit`).send({ admittedOn: '2031-07-01' });
    expect(
      (await api(f).post(`/clubs/${made.id}/suspend`).send({ suspendedOn: '2031-11-31' })).status,
    ).toBe(409);
    await api(f).post(`/clubs/${made.id}/suspend`).send({ suspendedOn: '2031-09-01' });
    expect(
      (await api(f).post(`/clubs/${made.id}/reinstate`).send({ reinstatedOn: '2031-02-30' }))
        .status,
    ).toBe(409);
  });

  it('refuses a malformed day on each transition', async () => {
    const f = floor();
    const made = await aClub(f);
    expect(
      (await api(f).post(`/clubs/${made.id}/admit`).send({ admittedOn: '1/7/31' })).status,
    ).toBe(400);
    expect(
      (await api(f).post(`/clubs/${made.id}/resign`).send({ leftOn: 'yesterday' })).status,
    ).toBe(400);
  });

  it('refuses a transition body that names the wrong day field', async () => {
    const f = floor();
    const made = await aClub(f);
    expect(
      (await api(f).post(`/clubs/${made.id}/admit`).send({ suspendedOn: '2031-07-01' })).status,
    ).toBe(400);
  });

  it('answers 404 on every transition when the club does not exist', async () => {
    const f = floor();
    expect((await api(f).post('/clubs/9907/admit').send({ admittedOn: '2031-07-01' })).status).toBe(
      404,
    );
    expect(
      (await api(f).post('/clubs/9907/suspend').send({ suspendedOn: '2031-07-01' })).status,
    ).toBe(404);
    expect(
      (await api(f).post('/clubs/9907/reinstate').send({ reinstatedOn: '2031-07-01' })).status,
    ).toBe(404);
    expect((await api(f).post('/clubs/9907/resign').send({ leftOn: '2031-07-01' })).status).toBe(
      404,
    );
  });
});

describe('changing a club', () => {
  it('changes what it is told to and leaves the rest alone', async () => {
    const f = floor();
    const made = await aClub(f);
    const res = await api(f)
      .patch(`/clubs/${made.id}`)
      .send({ contactEmail: 'new@ridgewayrovers.example' });
    expect(res.status).toBe(200);
    expect(res.body.contactEmail).toBe('new@ridgewayrovers.example');
    expect(res.body.name).toBe(made.name);
    expect(res.body.shortName).toBe(made.shortName);
  });

  it('clears a home ground when told null', async () => {
    const f = floor();
    const venue = await aVenue(f);
    const made = await aClub(f, { homeVenueId: venue.id });
    const res = await api(f).patch(`/clubs/${made.id}`).send({ homeVenueId: null });
    expect(res.status).toBe(200);
    expect(res.body.homeVenueId).toBe(null);
  });

  it('refuses a change that names nothing to change', async () => {
    const f = floor();
    const made = await aClub(f);
    expect((await api(f).patch(`/clubs/${made.id}`).send({})).status).toBe(400);
  });

  it('refuses changing the scoreboard letters, which are not offered', async () => {
    const f = floor();
    const made = await aClub(f);
    expect((await api(f).patch(`/clubs/${made.id}`).send({ shortName: 'ROV' })).status).toBe(400);
  });

  it('refuses renaming a club onto one that exists', async () => {
    const f = floor();
    await aClub(f, { name: 'Willow Athletic', shortName: 'WIL' });
    const second = await aClub(f);
    expect(
      (await api(f).patch(`/clubs/${second.id}`).send({ name: 'Willow Athletic' })).status,
    ).toBe(409);
  });

  it('will not change a club that has resigned', async () => {
    const f = floor();
    const made = await aClub(f);
    await api(f).post(`/clubs/${made.id}/resign`).send({ leftOn: '2031-06-15' });
    expect(
      (await api(f).patch(`/clubs/${made.id}`).send({ contactEmail: 'x@ridgewayrovers.example' }))
        .status,
    ).toBe(409);
  });
});

describe('who may settle a club', () => {
  it('needs a token on every club route', async () => {
    const f = floor();
    const made = await aClub(f);
    expect((await bare(f).post('/clubs').send(clubBody())).status).toBe(401);
    expect((await bare(f).get('/clubs')).status).toBe(401);
    expect((await bare(f).get(`/clubs/${made.id}`)).status).toBe(401);
    expect(
      (await bare(f).patch(`/clubs/${made.id}`).send({ contactEmail: 'a@b.example' })).status,
    ).toBe(401);
    expect(
      (await bare(f).post(`/clubs/${made.id}/admit`).send({ admittedOn: '2031-07-01' })).status,
    ).toBe(401);
    expect(
      (await bare(f).post(`/clubs/${made.id}/suspend`).send({ suspendedOn: '2031-07-01' })).status,
    ).toBe(401);
    expect(
      (await bare(f).post(`/clubs/${made.id}/reinstate`).send({ reinstatedOn: '2031-07-01' }))
        .status,
    ).toBe(401);
    expect(
      (await bare(f).post(`/clubs/${made.id}/resign`).send({ leftOn: '2031-07-01' })).status,
    ).toBe(401);
  });

  it('lets a registrar take an application but stops a discipline officer', async () => {
    const f = floor();
    const registrar = staffWith(f, 'registrar', 'reg-club@touchline.example');
    const officer = staffWith(f, 'discipline', 'disc-club@touchline.example');
    expect((await api(f, registrar).post('/clubs').send(clubBody())).status).toBe(201);
    expect(
      (
        await api(f, officer)
          .post('/clubs')
          .send(clubBody({ name: 'Other', shortName: 'OTH' }))
      ).status,
    ).toBe(409);
    expect((await api(f, officer).get('/clubs')).status).toBe(200);
  });
});

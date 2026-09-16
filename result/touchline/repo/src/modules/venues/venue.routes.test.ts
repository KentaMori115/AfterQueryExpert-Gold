import { api, bare, floor, staffWith, type Floor } from '../../../tests/helpers';

function venueBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Marsh Lane Recreation Ground',
    addressLine: '14 Marsh Lane, Ridgeway',
    postcode: 'RG4 7QP',
    surface: 'grass',
    pitchCount: 3,
    floodlit: false,
    ...overrides,
  };
}

async function aVenue(f: Floor, overrides: Record<string, unknown> = {}) {
  const res = await api(f).post('/venues').send(venueBody(overrides));
  return res.body;
}

describe('putting a ground on the list', () => {
  it('answers the whole shape back, open and unclosed', async () => {
    const f = floor();
    const res = await api(f).post('/venues').send(venueBody());
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual([
      'addressLine',
      'closedOn',
      'createdAt',
      'floodlit',
      'id',
      'name',
      'pitchCount',
      'postcode',
      'status',
      'surface',
      'updatedAt',
    ]);
    expect(res.body.status).toBe('open');
    expect(res.body.closedOn).toBe(null);
    expect(res.body.floodlit).toBe(false);
  });

  it('squares the postcode up as it stores it', async () => {
    const f = floor();
    const made = await aVenue(f, { postcode: 'rg4 7qp' });
    expect(made.postcode).toBe('RG4 7QP');
  });

  it('refuses a postcode that is not one', async () => {
    const f = floor();
    const res = await api(f)
      .post('/venues')
      .send(venueBody({ postcode: 'nowhere' }));
    expect(res.status).toBe(400);
  });

  it('refuses a surface the league does not play on', async () => {
    const f = floor();
    const res = await api(f)
      .post('/venues')
      .send(venueBody({ surface: 'sand' }));
    expect(res.status).toBe(400);
  });

  it('keeps the pitch count whole and inside its band from both sides', async () => {
    const f = floor();
    expect(
      (
        await api(f)
          .post('/venues')
          .send(venueBody({ pitchCount: 0 }))
      ).status,
    ).toBe(400);
    expect(
      (
        await api(f)
          .post('/venues')
          .send(venueBody({ pitchCount: 13 }))
      ).status,
    ).toBe(400);
    expect(
      (
        await api(f)
          .post('/venues')
          .send(venueBody({ pitchCount: 1.5 }))
      ).status,
    ).toBe(400);
    expect(
      (
        await api(f)
          .post('/venues')
          .send(venueBody({ pitchCount: 1 }))
      ).status,
    ).toBe(201);
    expect(
      (
        await api(f)
          .post('/venues')
          .send(venueBody({ name: 'Another Ground', pitchCount: 12 }))
      ).status,
    ).toBe(201);
  });

  it('refuses the same ground at the same postcode twice', async () => {
    const f = floor();
    await aVenue(f);
    const again = await api(f).post('/venues').send(venueBody());
    expect(again.status).toBe(409);

    const elsewhere = await api(f)
      .post('/venues')
      .send(venueBody({ postcode: 'RG9 1AA' }));
    expect(elsewhere.status).toBe(201);
  });

  it('refuses each required field being left out', async () => {
    const f = floor();
    for (const field of ['name', 'addressLine', 'postcode', 'surface', 'pitchCount', 'floodlit']) {
      const body = venueBody() as Record<string, unknown>;
      delete body[field];
      expect((await api(f).post('/venues').send(body)).status).toBe(400);
    }
  });

  it('refuses a body carrying a field it does not know', async () => {
    const f = floor();
    const res = await api(f)
      .post('/venues')
      .send(venueBody({ parking: true }));
    expect(res.status).toBe(400);
  });

  it('refuses a query on a route that takes no filters', async () => {
    const f = floor();
    expect((await api(f).post('/venues?force=true').send(venueBody())).status).toBe(400);
  });

  it('keeps the name inside its length band from both sides', async () => {
    const f = floor();
    expect(
      (
        await api(f)
          .post('/venues')
          .send(venueBody({ name: 'ab' }))
      ).status,
    ).toBe(400);
    expect(
      (
        await api(f)
          .post('/venues')
          .send(venueBody({ name: 'abc' }))
      ).status,
    ).toBe(201);
    expect(
      (
        await api(f)
          .post('/venues')
          .send(venueBody({ name: 'x'.repeat(91) }))
      ).status,
    ).toBe(400);
  });
});

describe('reading grounds back', () => {
  it('reads one ground', async () => {
    const f = floor();
    const made = await aVenue(f);
    const read = await api(f).get(`/venues/${made.id}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(made);
  });

  it('answers 404 for a ground nobody listed', async () => {
    const f = floor();
    const made = await aVenue(f);
    expect((await api(f).get(`/venues/${made.id}`)).status).toBe(200);
    expect((await api(f).get('/venues/9907')).status).toBe(404);
  });

  it('answers the list in a wrapper, by name and then by id', async () => {
    const f = floor();
    await aVenue(f, { name: 'Willow Park' });
    await aVenue(f, { name: 'Ashcroft Fields', postcode: 'RG9 1AA' });
    const res = await api(f).get('/venues');
    expect(res.status).toBe(200);
    expect(res.body.items.map((v: { name: string }) => v.name)).toEqual([
      'Ashcroft Fields',
      'Willow Park',
    ]);
  });

  it('narrows the list by surface, by status and by whether it is lit', async () => {
    const f = floor();
    const grass = await aVenue(f, { name: 'Willow Park' });
    const artificial = await aVenue(f, {
      name: 'Ashcroft Dome',
      postcode: 'RG9 1AA',
      surface: 'threeG',
      floodlit: true,
    });

    const bySurface = await api(f).get('/venues?surface=threeG');
    expect(bySurface.body.items.map((v: { id: number }) => v.id)).toEqual([artificial.id]);

    const lit = await api(f).get('/venues?floodlit=true');
    expect(lit.body.items.map((v: { id: number }) => v.id)).toEqual([artificial.id]);

    await api(f).post(`/venues/${grass.id}/close`).send({ closedOn: '2031-11-01' });
    const open = await api(f).get('/venues?status=open');
    expect(open.body.items.map((v: { id: number }) => v.id)).toEqual([artificial.id]);
  });

  it('refuses a filter it does not offer', async () => {
    const f = floor();
    expect((await api(f).get('/venues?postcode=RG4 7QP')).status).toBe(400);
    expect((await api(f).get('/venues')).status).toBe(200);
  });

  it('answers an empty list before any ground is listed', async () => {
    const f = floor();
    expect((await api(f).get('/venues')).body).toEqual({ items: [] });
  });
});

describe('closing and reopening a ground', () => {
  it('closes a ground and writes the day down', async () => {
    const f = floor();
    const made = await aVenue(f);
    const res = await api(f).post(`/venues/${made.id}/close`).send({ closedOn: '2031-11-01' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
    expect(res.body.closedOn).toBe('2031-11-01');
  });

  it('reopens it and forgets the day it closed', async () => {
    const f = floor();
    const made = await aVenue(f);
    await api(f).post(`/venues/${made.id}/close`).send({ closedOn: '2031-11-01' });
    const res = await api(f).post(`/venues/${made.id}/reopen`).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('open');
    expect(res.body.closedOn).toBe(null);
  });

  it('refuses closing what is closed and reopening what is open', async () => {
    const f = floor();
    const made = await aVenue(f);
    expect((await api(f).post(`/venues/${made.id}/reopen`).send({})).status).toBe(409);
    await api(f).post(`/venues/${made.id}/close`).send({ closedOn: '2031-11-01' });
    expect(
      (await api(f).post(`/venues/${made.id}/close`).send({ closedOn: '2031-11-02' })).status,
    ).toBe(409);
  });

  it('refuses a malformed day and a day that never happened when closing', async () => {
    const f = floor();
    const made = await aVenue(f);
    expect(
      (await api(f).post(`/venues/${made.id}/close`).send({ closedOn: '01-11-2031' })).status,
    ).toBe(400);
    expect(
      (await api(f).post(`/venues/${made.id}/close`).send({ closedOn: '2031-09-31' })).status,
    ).toBe(409);
  });

  it('will not change a ground once it is closed', async () => {
    const f = floor();
    const made = await aVenue(f);
    await api(f).post(`/venues/${made.id}/close`).send({ closedOn: '2031-11-01' });
    const res = await api(f).patch(`/venues/${made.id}`).send({ pitchCount: 4 });
    expect(res.status).toBe(409);
  });

  it('answers 404 when the ground being closed does not exist', async () => {
    const f = floor();
    const made = await aVenue(f);
    expect(
      (await api(f).post(`/venues/${made.id}/close`).send({ closedOn: '2031-11-01' })).status,
    ).toBe(200);
    expect((await api(f).post('/venues/9907/close').send({ closedOn: '2031-11-01' })).status).toBe(
      404,
    );
    expect((await api(f).post('/venues/9907/reopen').send({})).status).toBe(404);
  });
});

describe('changing a ground', () => {
  it('changes what it is told to and leaves the rest alone', async () => {
    const f = floor();
    const made = await aVenue(f);
    const res = await api(f).patch(`/venues/${made.id}`).send({ pitchCount: 5, floodlit: true });
    expect(res.status).toBe(200);
    expect(res.body.pitchCount).toBe(5);
    expect(res.body.floodlit).toBe(true);
    expect(res.body.postcode).toBe(made.postcode);
    expect(res.body.name).toBe(made.name);
  });

  it('refuses a change that names nothing to change', async () => {
    const f = floor();
    const made = await aVenue(f);
    expect((await api(f).patch(`/venues/${made.id}`).send({})).status).toBe(400);
  });

  it('refuses moving a ground to a postcode, which is not offered', async () => {
    const f = floor();
    const made = await aVenue(f);
    expect((await api(f).patch(`/venues/${made.id}`).send({ postcode: 'RG9 1AA' })).status).toBe(
      400,
    );
  });

  it('refuses renaming a ground onto another at the same postcode', async () => {
    const f = floor();
    await aVenue(f, { name: 'Willow Park' });
    const second = await aVenue(f, { name: 'Ashcroft Fields' });
    const res = await api(f).patch(`/venues/${second.id}`).send({ name: 'Willow Park' });
    expect(res.status).toBe(409);
  });
});

describe('who may settle a ground', () => {
  it('needs a token on every venue route', async () => {
    const f = floor();
    const made = await aVenue(f);
    expect((await bare(f).post('/venues').send(venueBody())).status).toBe(401);
    expect((await bare(f).get('/venues')).status).toBe(401);
    expect((await bare(f).get(`/venues/${made.id}`)).status).toBe(401);
    expect((await bare(f).patch(`/venues/${made.id}`).send({ pitchCount: 4 })).status).toBe(401);
    expect(
      (await bare(f).post(`/venues/${made.id}/close`).send({ closedOn: '2031-11-01' })).status,
    ).toBe(401);
    expect((await bare(f).post(`/venues/${made.id}/reopen`).send({})).status).toBe(401);
  });

  it('lets a registrar read a ground but not list a new one', async () => {
    const f = floor();
    const token = staffWith(f, 'registrar', 'reg-venue@touchline.example');
    expect((await api(f, token).get('/venues')).status).toBe(200);
    expect((await api(f, token).post('/venues').send(venueBody())).status).toBe(409);
  });
});

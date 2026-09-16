import {
  aClub,
  aMemberClub,
  api,
  bare,
  floor,
  staffWith,
  type Floor,
} from '../../../tests/helpers';

async function entries(f: Floor, query = '') {
  const res = await api(f).get(`/audit${query}`);
  return res.body.items as {
    id: number;
    staffId: number | null;
    method: string;
    path: string;
    status: number;
    outcome: string;
    bodyKeys: string[];
    happenedAt: string;
  }[];
}

describe('what the trail keeps', () => {
  it('writes a line for a write that went through', async () => {
    const f = floor();
    await aClub(f);
    const lines = await entries(f);
    const made = lines.find((line) => line.path === '/clubs' && line.method === 'POST');
    expect(made).toBeDefined();
    expect(made?.status).toBe(201);
    expect(made?.outcome).toBe('accepted');
    expect(made?.staffId).toBe(f.secretary.id);
  });

  it('gives every field of a line by value', async () => {
    const f = floor();
    await aClub(f);
    const lines = await entries(f);
    const made = lines.find((line) => line.path === '/clubs');
    expect(Object.keys(made ?? {}).sort()).toEqual([
      'bodyKeys',
      'happenedAt',
      'id',
      'method',
      'outcome',
      'path',
      'staffId',
      'status',
    ]);
  });

  it('keeps the line for a write the league refused', async () => {
    const f = floor();
    await aClub(f);
    await aClub(f);
    const lines = await entries(f, '?outcome=refused');
    const refused = lines.find((line) => line.path === '/clubs');
    expect(refused).toBeDefined();
    expect(refused?.status).toBe(409);
    expect(refused?.outcome).toBe('refused');
  });

  it('keeps the line for a write that would not even parse', async () => {
    const f = floor();
    await api(f).post('/clubs').send({ name: 'x' });
    const lines = await entries(f, '?outcome=refused');
    expect(lines.some((line) => line.status === 400)).toBe(true);
  });

  it('keeps a line for an attempt nobody was signed in for', async () => {
    const f = floor();
    await bare(f).post('/clubs').send({ name: 'Ridgeway Rovers' });
    const lines = await entries(f);
    const anonymous = lines.find((line) => line.path === '/clubs' && line.status === 401);
    expect(anonymous).toBeDefined();
    expect(anonymous?.staffId).toBe(null);
    expect(anonymous?.outcome).toBe('refused');
  });

  it('records the field names that were sent but never their values', async () => {
    const f = floor();
    await bare(f)
      .post('/auth/sessions')
      .send({ email: 'secretary@touchline.example', password: 'a-long-enough-secret' });
    const lines = await entries(f);
    const signIn = lines.find((line) => line.path === '/auth/sessions');
    expect(signIn?.bodyKeys).toEqual(['email', 'password']);
    expect(JSON.stringify(signIn)).not.toContain('a-long-enough-secret');
  });

  it('sorts the field names so two identical attempts read identically', async () => {
    const f = floor();
    await api(f).post('/venues').send({
      pitchCount: 3,
      floodlit: false,
      addressLine: '14 Marsh Lane',
      name: 'Marsh Lane',
      surface: 'grass',
      postcode: 'RG4 7QP',
    });
    const lines = await entries(f);
    const made = lines.find((line) => line.path === '/venues');
    expect(made?.bodyKeys).toEqual([
      'addressLine',
      'floodlit',
      'name',
      'pitchCount',
      'postcode',
      'surface',
    ]);
  });

  it('leaves reads out of the trail entirely', async () => {
    const f = floor();
    await api(f).get('/clubs');
    await api(f).get('/venues');
    const lines = await entries(f);
    expect(lines.every((line) => line.method !== 'GET')).toBe(true);
  });

  it('keeps a line for each of the other methods that change something', async () => {
    const f = floor();
    const club = await aClub(f);
    await api(f).patch(`/clubs/${club.id}`).send({ contactEmail: 'new@touchline.example' });

    // A colleague signs themselves out, rather than the secretary, whose token
    // is still needed to read the trail back afterwards.
    const other = staffWith(f, 'registrar', 'signs-out@touchline.example');
    await api(f, other).delete('/auth/sessions/current');

    const lines = await entries(f);
    expect(lines.some((line) => line.method === 'PATCH')).toBe(true);
    expect(lines.some((line) => line.method === 'DELETE')).toBe(true);
  });

  it('reads newest first', async () => {
    const f = floor();
    await aClub(f);
    await aClub(f, { name: 'Willow Athletic', shortName: 'WIL' });
    const lines = await entries(f);
    const ids = lines.map((line) => line.id);
    expect([...ids].sort((a, b) => b - a)).toEqual(ids);
  });
});

describe('reading the trail back', () => {
  it('reads one line', async () => {
    const f = floor();
    await aClub(f);
    const lines = await entries(f);
    const first = lines[0];
    const read = await api(f).get(`/audit/${first?.id}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(first);
  });

  it('answers 404 for a line nobody wrote', async () => {
    const f = floor();
    await aClub(f);
    const lines = await entries(f);
    expect((await api(f).get(`/audit/${lines[0]?.id}`)).status).toBe(200);
    expect((await api(f).get('/audit/9907')).status).toBe(404);
  });

  it('narrows by who did it, what they did and how it went', async () => {
    const f = floor();
    await aMemberClub(f);
    await api(f).post('/clubs').send({ name: 'x' });

    expect((await entries(f, `?staffId=${f.secretary.id}`)).length).toBeGreaterThan(0);
    expect((await entries(f, '?method=POST')).every((l) => l.method === 'POST')).toBe(true);
    expect((await entries(f, '?outcome=accepted')).every((l) => l.outcome === 'accepted')).toBe(
      true,
    );
  });

  it('narrows by the start of a path', async () => {
    const f = floor();
    const club = await aMemberClub(f);
    await api(f).post('/venues').send({
      name: 'Marsh Lane',
      addressLine: '14 Marsh Lane',
      postcode: 'RG4 7QP',
      surface: 'grass',
      pitchCount: 3,
      floodlit: false,
    });

    const clubLines = await entries(f, '?path=/clubs');
    expect(clubLines.length).toBeGreaterThan(0);
    expect(clubLines.every((line) => line.path.startsWith('/clubs'))).toBe(true);
    expect(clubLines.some((line) => line.path === `/clubs/${club.id}/admit`)).toBe(true);
    expect(clubLines.every((line) => !line.path.startsWith('/venues'))).toBe(true);
  });

  it('refuses a method or an outcome it does not have', async () => {
    const f = floor();
    await aClub(f);
    expect((await api(f).get('/audit?method=OPTIONS')).status).toBe(400);
    expect((await api(f).get('/audit?outcome=maybe')).status).toBe(400);
  });

  it('refuses a filter it does not offer', async () => {
    const f = floor();
    await aClub(f);
    expect((await api(f).get('/audit?status=201')).status).toBe(400);
    expect((await api(f).get('/audit')).status).toBe(200);
  });

  it('refuses a query on the single-line route', async () => {
    const f = floor();
    await aClub(f);
    const lines = await entries(f);
    expect((await api(f).get(`/audit/${lines[0]?.id}?verbose=true`)).status).toBe(400);
  });

  it('answers an empty list when nothing has been written', async () => {
    const f = floor();
    expect((await api(f).get('/audit')).body).toEqual({ items: [] });
  });
});

describe('who may look at the trail', () => {
  it('needs a token on both audit routes', async () => {
    const f = floor();
    await aClub(f);
    const lines = await entries(f);
    expect((await bare(f).get('/audit')).status).toBe(401);
    expect((await bare(f).get(`/audit/${lines[0]?.id}`)).status).toBe(401);
    expect((await api(f).get('/audit')).status).toBe(200);
  });

  it('keeps the trail to the secretary rather than anybody holding a token', async () => {
    const f = floor();
    await aClub(f);
    const registrar = staffWith(f, 'registrar', 'reg-audit@touchline.example');
    const officer = staffWith(f, 'discipline', 'disc-audit@touchline.example');
    expect((await api(f, registrar).get('/audit')).status).toBe(409);
    expect((await api(f, officer).get('/audit')).status).toBe(409);
    expect((await api(f).get('/audit')).status).toBe(200);
  });
});

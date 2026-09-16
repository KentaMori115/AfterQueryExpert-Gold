import { api, bare, floor, staffWith, FOUNDER_PASSWORD } from '../../../tests/helpers';

const FOUNDER = 'secretary@touchline.example';

function newStaffBody(overrides: Record<string, unknown> = {}) {
  return {
    email: 'registrar@touchline.example',
    fullName: 'Bea Marchetti',
    role: 'registrar',
    password: 'another-long-secret',
    ...overrides,
  };
}

describe('signing in', () => {
  it('hands back a token that says who it belongs to and when it lapses', async () => {
    const f = floor();
    const res = await bare(f)
      .post('/auth/sessions')
      .send({ email: FOUNDER, password: FOUNDER_PASSWORD });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual([
      'expiresAt',
      'issuedAt',
      'role',
      'staffId',
      'token',
    ]);
    expect(res.body.staffId).toBe(f.secretary.id);
    expect(res.body.role).toBe('secretary');
    expect(typeof res.body.token).toBe('string');
    expect(Date.parse(res.body.expiresAt)).toBeGreaterThan(Date.parse(res.body.issuedAt));
  });

  it('refuses a password that is merely close', async () => {
    const f = floor();
    const res = await bare(f)
      .post('/auth/sessions')
      .send({ email: FOUNDER, password: `${FOUNDER_PASSWORD}x` });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorised');
  });

  it('answers an address nobody holds exactly as it answers a wrong password', async () => {
    const f = floor();
    const unknown = await bare(f)
      .post('/auth/sessions')
      .send({ email: 'nobody@touchline.example', password: FOUNDER_PASSWORD });
    const wrong = await bare(f)
      .post('/auth/sessions')
      .send({ email: FOUNDER, password: 'not-the-right-one' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('turns away somebody who has been stood down', async () => {
    const f = floor();
    const made = await api(f).post('/staff').send(newStaffBody());
    await api(f).patch(`/staff/${made.body.id}`).send({ active: false });
    const res = await bare(f)
      .post('/auth/sessions')
      .send({ email: 'registrar@touchline.example', password: 'another-long-secret' });
    expect(res.status).toBe(401);
  });

  it('refuses a body carrying a field it does not know', async () => {
    const f = floor();
    const res = await bare(f)
      .post('/auth/sessions')
      .send({ email: FOUNDER, password: FOUNDER_PASSWORD, remember: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('refuses a query on a route that takes no filters', async () => {
    const f = floor();
    const res = await bare(f)
      .post('/auth/sessions?redirect=/home')
      .send({ email: FOUNDER, password: FOUNDER_PASSWORD });
    expect(res.status).toBe(400);
  });

  it('refuses an address that is not an address', async () => {
    const f = floor();
    const res = await bare(f)
      .post('/auth/sessions')
      .send({ email: 'not-an-address', password: FOUNDER_PASSWORD });
    expect(res.status).toBe(400);
  });

  it('refuses each required field being left out', async () => {
    const f = floor();
    const noEmail = await bare(f).post('/auth/sessions').send({ password: FOUNDER_PASSWORD });
    const noPassword = await bare(f).post('/auth/sessions').send({ email: FOUNDER });
    expect(noEmail.status).toBe(400);
    expect(noPassword.status).toBe(400);
  });
});

describe('the session a token stands for', () => {
  it('says who is holding it', async () => {
    const f = floor();
    const res = await api(f).get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(FOUNDER);
    expect(res.body.role).toBe('secretary');
    expect(res.body).not.toHaveProperty('password');
  });

  it('needs a token at all', async () => {
    const f = floor();
    expect((await bare(f).get('/auth/me')).status).toBe(401);
    expect((await api(f).get('/auth/me')).status).toBe(200);
  });

  it('refuses a header that is not shaped like a bearer token', async () => {
    const f = floor();
    const res = await bare(f).get('/auth/me').set('Authorization', f.token);
    expect(res.status).toBe(401);
  });

  it('refuses a token nobody was ever given', async () => {
    const f = floor();
    const res = await bare(f).get('/auth/me').set('Authorization', 'Bearer 0000invented0000');
    expect(res.status).toBe(401);
  });

  it('stops working once it has been signed out', async () => {
    const f = floor();
    expect((await api(f).get('/auth/me')).status).toBe(200);
    const out = await api(f).delete('/auth/sessions/current');
    expect(out.status).toBe(200);
    expect(typeof out.body.endedAt).toBe('string');
    expect((await api(f).get('/auth/me')).status).toBe(401);
  });

  it('needs a token to sign out with', async () => {
    const f = floor();
    expect((await bare(f).delete('/auth/sessions/current')).status).toBe(401);
    expect((await api(f).delete('/auth/sessions/current')).status).toBe(200);
  });
});

describe('keeping the staff list', () => {
  it('takes on a colleague and answers the whole shape back', async () => {
    const f = floor();
    const res = await api(f).post('/staff').send(newStaffBody());
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual([
      'active',
      'createdAt',
      'email',
      'fullName',
      'id',
      'role',
      'updatedAt',
    ]);
    expect(res.body.role).toBe('registrar');
    expect(res.body.active).toBe(true);
    expect(res.body).not.toHaveProperty('password');
  });

  it('refuses an address somebody already holds', async () => {
    const f = floor();
    await api(f).post('/staff').send(newStaffBody());
    const again = await api(f)
      .post('/staff')
      .send(newStaffBody({ fullName: 'Someone Else' }));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('conflict');
  });

  it('refuses a role the league does not have', async () => {
    const f = floor();
    const res = await api(f)
      .post('/staff')
      .send(newStaffBody({ role: 'groundsman' }));
    expect(res.status).toBe(400);
  });

  it('refuses a password shorter than the floor and accepts one exactly at it', async () => {
    const f = floor();
    const tooShort = await api(f)
      .post('/staff')
      .send(newStaffBody({ password: 'x'.repeat(9) }));
    const exactly = await api(f)
      .post('/staff')
      .send(newStaffBody({ password: 'x'.repeat(10) }));
    expect(tooShort.status).toBe(400);
    expect(exactly.status).toBe(201);
  });

  it('reads one colleague back', async () => {
    const f = floor();
    const made = await api(f).post('/staff').send(newStaffBody());
    const read = await api(f).get(`/staff/${made.body.id}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(made.body);
  });

  it('answers 404 for a colleague nobody took on', async () => {
    const f = floor();
    const made = await api(f).post('/staff').send(newStaffBody());
    expect((await api(f).get(`/staff/${made.body.id}`)).status).toBe(200);
    expect((await api(f).get('/staff/9907')).status).toBe(404);
  });

  it('answers the list in a wrapper, by name and then by id', async () => {
    const f = floor();
    await api(f)
      .post('/staff')
      .send(newStaffBody({ fullName: 'Zeno Abbas' }));
    await api(f)
      .post('/staff')
      .send(newStaffBody({ email: 'b@touchline.example', fullName: 'Bea Marchetti' }));
    const res = await api(f).get('/staff');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.map((s: { fullName: string }) => s.fullName)).toEqual([
      'Ada Fenwick',
      'Bea Marchetti',
      'Zeno Abbas',
    ]);
  });

  it('narrows the list by role and by whether they are still with the league', async () => {
    const f = floor();
    const made = await api(f).post('/staff').send(newStaffBody());
    const byRole = await api(f).get('/staff?role=registrar');
    expect(byRole.body.items).toHaveLength(1);
    expect(byRole.body.items[0].id).toBe(made.body.id);

    await api(f).patch(`/staff/${made.body.id}`).send({ active: false });
    const stillHere = await api(f).get('/staff?active=true');
    expect(stillHere.body.items.map((s: { id: number }) => s.id)).toEqual([f.secretary.id]);
  });

  it('refuses a filter it does not offer', async () => {
    const f = floor();
    expect((await api(f).get('/staff?name=Ada')).status).toBe(400);
    expect((await api(f).get('/staff')).status).toBe(200);
  });

  it('changes what it is told to and leaves the rest alone', async () => {
    const f = floor();
    const made = await api(f).post('/staff').send(newStaffBody());
    const res = await api(f)
      .patch(`/staff/${made.body.id}`)
      .send({ fullName: 'Bea Marchetti-Rowe' });
    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe('Bea Marchetti-Rowe');
    expect(res.body.role).toBe('registrar');
    expect(res.body.email).toBe(made.body.email);
  });

  it('refuses a change that names nothing to change', async () => {
    const f = floor();
    const made = await api(f).post('/staff').send(newStaffBody());
    expect((await api(f).patch(`/staff/${made.body.id}`).send({})).status).toBe(400);
  });

  it('refuses a change carrying a field it does not know', async () => {
    const f = floor();
    const made = await api(f).post('/staff').send(newStaffBody());
    const res = await api(f)
      .patch(`/staff/${made.body.id}`)
      .send({ email: 'new@touchline.example' });
    expect(res.status).toBe(400);
  });

  it('will not leave the league without anybody able to run it', async () => {
    const f = floor();
    const standDown = await api(f).patch(`/staff/${f.secretary.id}`).send({ active: false });
    expect(standDown.status).toBe(409);

    await api(f)
      .post('/staff')
      .send(newStaffBody({ role: 'secretary' }));
    const nowFine = await api(f).patch(`/staff/${f.secretary.id}`).send({ active: false });
    expect(nowFine.status).toBe(200);
  });

  it('needs a token on every staff route', async () => {
    const f = floor();
    const made = await api(f).post('/staff').send(newStaffBody());
    expect(
      (
        await bare(f)
          .post('/staff')
          .send(newStaffBody({ email: 'c@touchline.example' }))
      ).status,
    ).toBe(401);
    expect((await bare(f).get('/staff')).status).toBe(401);
    expect((await bare(f).get(`/staff/${made.body.id}`)).status).toBe(401);
    expect((await bare(f).patch(`/staff/${made.body.id}`).send({ fullName: 'Nope' })).status).toBe(
      401,
    );
  });

  it('lets a registrar read the staff list but not change it', async () => {
    const f = floor();
    const token = staffWith(f, 'registrar', 'reg2@touchline.example');
    expect((await api(f, token).get('/staff')).status).toBe(200);
    const write = await api(f, token)
      .post('/staff')
      .send(newStaffBody({ email: 'd@touchline.example' }));
    expect(write.status).toBe(409);
    expect(write.body.error.code).toBe('conflict');
  });
});

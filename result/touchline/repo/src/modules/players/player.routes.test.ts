import {
  aClub,
  aMemberClub,
  api,
  bare,
  floor,
  staffWith,
  type Floor,
} from '../../../tests/helpers';

function playerBody(overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Owen',
    lastName: 'Tasker',
    bornOn: '2005-03-14',
    position: 'midfielder',
    squadNumber: 8,
    registeredOn: '2031-07-20',
    ...overrides,
  };
}

async function aPlayer(f: Floor, clubId: number, overrides: Record<string, unknown> = {}) {
  const res = await api(f).post(`/clubs/${clubId}/players`).send(playerBody(overrides));
  return res.body;
}

async function aClubWithPlayer(f: Floor) {
  const club = await aMemberClub(f);
  const player = await aPlayer(f, club.id);
  return { club, player };
}

describe('registering a player', () => {
  it('answers the whole shape back, registered and unreleased', async () => {
    const f = floor();
    const club = await aMemberClub(f);
    const res = await api(f).post(`/clubs/${club.id}/players`).send(playerBody());
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual([
      'bornOn',
      'clubId',
      'createdAt',
      'firstName',
      'id',
      'lastName',
      'position',
      'registeredOn',
      'releasedOn',
      'squadNumber',
      'status',
      'updatedAt',
    ]);
    expect(res.body.clubId).toBe(club.id);
    expect(res.body.status).toBe('registered');
    expect(res.body.releasedOn).toBe(null);
  });

  it('refuses a club that is not a member', async () => {
    const f = floor();
    const applicant = await aClub(f);
    const res = await api(f).post(`/clubs/${applicant.id}/players`).send(playerBody());
    expect(res.status).toBe(409);
  });

  it('settles age against the day of registration, not against today', async () => {
    const f = floor();
    const club = await aMemberClub(f);
    const dayBefore16 = await api(f)
      .post(`/clubs/${club.id}/players`)
      .send(playerBody({ bornOn: '2015-07-21' }));
    expect(dayBefore16.status).toBe(409);

    const exactly16 = await api(f)
      .post(`/clubs/${club.id}/players`)
      .send(playerBody({ bornOn: '2015-07-20', squadNumber: 9 }));
    expect(exactly16.status).toBe(201);
  });

  it('refuses somebody older than the league believes', async () => {
    const f = floor();
    const club = await aMemberClub(f);
    const tooOld = await api(f)
      .post(`/clubs/${club.id}/players`)
      .send(playerBody({ bornOn: '1955-07-19' }));
    expect(tooOld.status).toBe(409);

    const justInside = await api(f)
      .post(`/clubs/${club.id}/players`)
      .send(playerBody({ bornOn: '1961-07-21', squadNumber: 10 }));
    expect(justInside.status).toBe(201);
  });

  it('refuses registering before the player was born', async () => {
    const f = floor();
    const club = await aMemberClub(f);
    const res = await api(f)
      .post(`/clubs/${club.id}/players`)
      .send(playerBody({ bornOn: '2032-01-01' }));
    expect(res.status).toBe(409);
  });

  it('holds a squad number against one registered player per club', async () => {
    const f = floor();
    const club = await aMemberClub(f);
    await aPlayer(f, club.id);
    const clash = await api(f)
      .post(`/clubs/${club.id}/players`)
      .send(playerBody({ firstName: 'Nathan', lastName: 'Ives' }));
    expect(clash.status).toBe(409);

    const free = await api(f)
      .post(`/clubs/${club.id}/players`)
      .send(playerBody({ firstName: 'Nathan', lastName: 'Ives', squadNumber: 9 }));
    expect(free.status).toBe(201);
  });

  it('lets another club use the same number', async () => {
    const f = floor();
    const first = await aMemberClub(f);
    const second = await aMemberClub(f, {
      name: 'Willow Athletic',
      shortName: 'WIL',
      contactEmail: 'w@touchline.example',
    });
    await aPlayer(f, first.id);
    const res = await api(f).post(`/clubs/${second.id}/players`).send(playerBody());
    expect(res.status).toBe(201);
  });

  it('keeps the squad number whole and inside its band from both sides', async () => {
    const f = floor();
    const club = await aMemberClub(f);
    for (const squadNumber of [0, 100, 8.5]) {
      const res = await api(f).post(`/clubs/${club.id}/players`).send(playerBody({ squadNumber }));
      expect(res.status).toBe(400);
    }
    expect(
      (
        await api(f)
          .post(`/clubs/${club.id}/players`)
          .send(playerBody({ squadNumber: 1 }))
      ).status,
    ).toBe(201);
    expect(
      (
        await api(f)
          .post(`/clubs/${club.id}/players`)
          .send(playerBody({ squadNumber: 99, lastName: 'Nunn' }))
      ).status,
    ).toBe(201);
  });

  it('refuses a position the league does not know', async () => {
    const f = floor();
    const club = await aMemberClub(f);
    const res = await api(f)
      .post(`/clubs/${club.id}/players`)
      .send(playerBody({ position: 'sweeper' }));
    expect(res.status).toBe(400);
  });

  it('refuses a malformed day and one that never happened, on both days it takes', async () => {
    const f = floor();
    const club = await aMemberClub(f);
    expect(
      (
        await api(f)
          .post(`/clubs/${club.id}/players`)
          .send(playerBody({ bornOn: '14-03-2005' }))
      ).status,
    ).toBe(400);
    expect(
      (
        await api(f)
          .post(`/clubs/${club.id}/players`)
          .send(playerBody({ bornOn: '2005-02-30' }))
      ).status,
    ).toBe(409);
    expect(
      (
        await api(f)
          .post(`/clubs/${club.id}/players`)
          .send(playerBody({ registeredOn: '20-07-2031' }))
      ).status,
    ).toBe(400);
    expect(
      (
        await api(f)
          .post(`/clubs/${club.id}/players`)
          .send(playerBody({ registeredOn: '2031-06-31' }))
      ).status,
    ).toBe(409);
  });

  it('refuses each required field being left out', async () => {
    const f = floor();
    const club = await aMemberClub(f);
    for (const field of [
      'firstName',
      'lastName',
      'bornOn',
      'position',
      'squadNumber',
      'registeredOn',
    ]) {
      const body = playerBody() as Record<string, unknown>;
      delete body[field];
      expect((await api(f).post(`/clubs/${club.id}/players`).send(body)).status).toBe(400);
    }
  });

  it('keeps each name inside its length band from both sides', async () => {
    const f = floor();
    const club = await aMemberClub(f);
    expect(
      (
        await api(f)
          .post(`/clubs/${club.id}/players`)
          .send(playerBody({ firstName: 'O' }))
      ).status,
    ).toBe(400);
    expect(
      (
        await api(f)
          .post(`/clubs/${club.id}/players`)
          .send(playerBody({ lastName: 'x'.repeat(61) }))
      ).status,
    ).toBe(400);
    expect(
      (
        await api(f)
          .post(`/clubs/${club.id}/players`)
          .send(playerBody({ firstName: 'Ow' }))
      ).status,
    ).toBe(201);
  });

  it('refuses a body carrying a field it does not know', async () => {
    const f = floor();
    const club = await aMemberClub(f);
    const res = await api(f)
      .post(`/clubs/${club.id}/players`)
      .send(playerBody({ nickname: 'Tank' }));
    expect(res.status).toBe(400);
  });

  it('refuses a query on a route that takes no filters', async () => {
    const f = floor();
    const club = await aMemberClub(f);
    expect(
      (await api(f).post(`/clubs/${club.id}/players?notify=true`).send(playerBody())).status,
    ).toBe(400);
  });

  it('answers 404 when the club does not exist', async () => {
    const f = floor();
    expect((await api(f).post('/clubs/9907/players').send(playerBody())).status).toBe(404);
  });
});

describe('reading players back', () => {
  it('reads one player', async () => {
    const f = floor();
    const { player } = await aClubWithPlayer(f);
    const read = await api(f).get(`/players/${player.id}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(player);
  });

  it('answers 404 for a player nobody registered', async () => {
    const f = floor();
    const { player } = await aClubWithPlayer(f);
    expect((await api(f).get(`/players/${player.id}`)).status).toBe(200);
    expect((await api(f).get('/players/9907')).status).toBe(404);
  });

  it('answers both lists in a wrapper, by last name then first name then id', async () => {
    const f = floor();
    const club = await aMemberClub(f);
    await aPlayer(f, club.id, { firstName: 'Zoe', lastName: 'Warrender', squadNumber: 4 });
    await aPlayer(f, club.id, { firstName: 'Alan', lastName: 'Ashby', squadNumber: 5 });
    await aPlayer(f, club.id, { firstName: 'Bea', lastName: 'Ashby', squadNumber: 6 });

    const forClub = await api(f).get(`/clubs/${club.id}/players`);
    expect(forClub.status).toBe(200);
    expect(forClub.body.items.map((p: { firstName: string }) => p.firstName)).toEqual([
      'Alan',
      'Bea',
      'Zoe',
    ]);

    const all = await api(f).get('/players');
    expect(all.body.items.map((p: { firstName: string }) => p.firstName)).toEqual([
      'Alan',
      'Bea',
      'Zoe',
    ]);
  });

  it('narrows both lists by position and by status', async () => {
    const f = floor();
    const club = await aMemberClub(f);
    const keeper = await aPlayer(f, club.id, { position: 'goalkeeper', squadNumber: 1 });
    const gone = await aPlayer(f, club.id, { squadNumber: 12, lastName: 'Norrie' });
    await api(f).post(`/players/${gone.id}/release`).send({ releasedOn: '2031-09-01' });

    const keepers = await api(f).get(`/clubs/${club.id}/players?position=goalkeeper`);
    expect(keepers.body.items.map((p: { id: number }) => p.id)).toEqual([keeper.id]);

    const released = await api(f).get('/players?status=released');
    expect(released.body.items.map((p: { id: number }) => p.id)).toEqual([gone.id]);
  });

  it('answers 404 when listing against a club that does not exist', async () => {
    const f = floor();
    const club = await aMemberClub(f);
    expect((await api(f).get(`/clubs/${club.id}/players`)).status).toBe(200);
    expect((await api(f).get('/clubs/9907/players')).status).toBe(404);
    expect((await api(f).get('/players?clubId=9907')).status).toBe(404);
  });

  it('refuses a filter neither list offers', async () => {
    const f = floor();
    const club = await aMemberClub(f);
    expect((await api(f).get(`/clubs/${club.id}/players?lastName=Tasker`)).status).toBe(400);
    expect((await api(f).get('/players?lastName=Tasker')).status).toBe(400);
    expect((await api(f).get('/players')).status).toBe(200);
  });

  it('answers an empty list for a club with nobody registered', async () => {
    const f = floor();
    const club = await aMemberClub(f);
    expect((await api(f).get(`/clubs/${club.id}/players`)).body).toEqual({ items: [] });
  });
});

describe('releasing and transferring a player', () => {
  it('releases a player and writes the day down', async () => {
    const f = floor();
    const { player } = await aClubWithPlayer(f);
    const res = await api(f)
      .post(`/players/${player.id}/release`)
      .send({ releasedOn: '2031-09-01' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('released');
    expect(res.body.releasedOn).toBe('2031-09-01');
  });

  it('frees the squad number once a player is released', async () => {
    const f = floor();
    const { club, player } = await aClubWithPlayer(f);
    await api(f).post(`/players/${player.id}/release`).send({ releasedOn: '2031-09-01' });
    const replacement = await api(f)
      .post(`/clubs/${club.id}/players`)
      .send(playerBody({ firstName: 'Nathan', lastName: 'Ives' }));
    expect(replacement.status).toBe(201);
    expect(replacement.body.squadNumber).toBe(8);
  });

  it('refuses releasing twice and releasing before registration', async () => {
    const f = floor();
    const { player } = await aClubWithPlayer(f);
    expect(
      (await api(f).post(`/players/${player.id}/release`).send({ releasedOn: '2031-07-19' }))
        .status,
    ).toBe(409);
    await api(f).post(`/players/${player.id}/release`).send({ releasedOn: '2031-09-01' });
    expect(
      (await api(f).post(`/players/${player.id}/release`).send({ releasedOn: '2031-09-02' }))
        .status,
    ).toBe(409);
  });

  it('transfers a player and moves the registration day with them', async () => {
    const f = floor();
    const { player } = await aClubWithPlayer(f);
    const other = await aMemberClub(f, {
      name: 'Willow Athletic',
      shortName: 'WIL',
      contactEmail: 'w@touchline.example',
    });
    const res = await api(f)
      .post(`/players/${player.id}/transfer`)
      .send({ clubId: other.id, transferredOn: '2031-08-15', squadNumber: 21 });
    expect(res.status).toBe(200);
    expect(res.body.clubId).toBe(other.id);
    expect(res.body.squadNumber).toBe(21);
    expect(res.body.registeredOn).toBe('2031-08-15');
    expect(res.body.status).toBe('registered');
  });

  it('refuses a transfer to the club the player is already at', async () => {
    const f = floor();
    const { club, player } = await aClubWithPlayer(f);
    const res = await api(f)
      .post(`/players/${player.id}/transfer`)
      .send({ clubId: club.id, transferredOn: '2031-08-15', squadNumber: 21 });
    expect(res.status).toBe(409);
  });

  it('refuses a transfer to a club that is not a member', async () => {
    const f = floor();
    const { player } = await aClubWithPlayer(f);
    const applicant = await aClub(f, {
      name: 'Willow Athletic',
      shortName: 'WIL',
      contactEmail: 'w@touchline.example',
    });
    const res = await api(f)
      .post(`/players/${player.id}/transfer`)
      .send({ clubId: applicant.id, transferredOn: '2031-08-15', squadNumber: 21 });
    expect(res.status).toBe(409);
  });

  it('refuses a transfer onto a number taken at the receiving club', async () => {
    const f = floor();
    const { player } = await aClubWithPlayer(f);
    const other = await aMemberClub(f, {
      name: 'Willow Athletic',
      shortName: 'WIL',
      contactEmail: 'w@touchline.example',
    });
    await aPlayer(f, other.id, { squadNumber: 21, lastName: 'Norrie' });
    const res = await api(f)
      .post(`/players/${player.id}/transfer`)
      .send({ clubId: other.id, transferredOn: '2031-08-15', squadNumber: 21 });
    expect(res.status).toBe(409);
  });

  it('refuses a transfer of a released player and one preceding the registration', async () => {
    const f = floor();
    const { player } = await aClubWithPlayer(f);
    const other = await aMemberClub(f, {
      name: 'Willow Athletic',
      shortName: 'WIL',
      contactEmail: 'w@touchline.example',
    });
    expect(
      (
        await api(f)
          .post(`/players/${player.id}/transfer`)
          .send({ clubId: other.id, transferredOn: '2031-07-19', squadNumber: 21 })
      ).status,
    ).toBe(409);

    await api(f).post(`/players/${player.id}/release`).send({ releasedOn: '2031-09-01' });
    expect(
      (
        await api(f)
          .post(`/players/${player.id}/transfer`)
          .send({ clubId: other.id, transferredOn: '2031-09-02', squadNumber: 21 })
      ).status,
    ).toBe(409);
  });

  it('refuses an impossible day on both transitions', async () => {
    const f = floor();
    const { player } = await aClubWithPlayer(f);
    const other = await aMemberClub(f, {
      name: 'Willow Athletic',
      shortName: 'WIL',
      contactEmail: 'w@touchline.example',
    });
    expect(
      (await api(f).post(`/players/${player.id}/release`).send({ releasedOn: '2031-11-31' }))
        .status,
    ).toBe(409);
    expect(
      (
        await api(f)
          .post(`/players/${player.id}/transfer`)
          .send({ clubId: other.id, transferredOn: '2031-02-30', squadNumber: 21 })
      ).status,
    ).toBe(409);
  });

  it('refuses a transition body that names the wrong field', async () => {
    const f = floor();
    const { player } = await aClubWithPlayer(f);
    expect(
      (await api(f).post(`/players/${player.id}/release`).send({ leftOn: '2031-09-01' })).status,
    ).toBe(400);
    expect(
      (
        await api(f)
          .post(`/players/${player.id}/transfer`)
          .send({ clubId: 2, transferredOn: '2031-08-15' })
      ).status,
    ).toBe(400);
  });

  it('answers 404 when the player or the receiving club does not exist', async () => {
    const f = floor();
    const { player } = await aClubWithPlayer(f);
    expect(
      (await api(f).post('/players/9907/release').send({ releasedOn: '2031-09-01' })).status,
    ).toBe(404);
    expect(
      (
        await api(f)
          .post(`/players/${player.id}/transfer`)
          .send({ clubId: 9907, transferredOn: '2031-08-15', squadNumber: 21 })
      ).status,
    ).toBe(404);
  });
});

describe('changing a player', () => {
  it('changes what it is told to and leaves the rest alone', async () => {
    const f = floor();
    const { player } = await aClubWithPlayer(f);
    const res = await api(f).patch(`/players/${player.id}`).send({ position: 'forward' });
    expect(res.status).toBe(200);
    expect(res.body.position).toBe('forward');
    expect(res.body.squadNumber).toBe(player.squadNumber);
    expect(res.body.bornOn).toBe(player.bornOn);
  });

  it('lets a player keep their own number when nothing else changes', async () => {
    const f = floor();
    const { player } = await aClubWithPlayer(f);
    const res = await api(f).patch(`/players/${player.id}`).send({ squadNumber: 8 });
    expect(res.status).toBe(200);
    expect(res.body.squadNumber).toBe(8);
  });

  it('refuses moving onto a number somebody else wears', async () => {
    const f = floor();
    const { club, player } = await aClubWithPlayer(f);
    await aPlayer(f, club.id, { squadNumber: 9, lastName: 'Norrie' });
    expect((await api(f).patch(`/players/${player.id}`).send({ squadNumber: 9 })).status).toBe(409);
  });

  it('refuses a change that names nothing to change', async () => {
    const f = floor();
    const { player } = await aClubWithPlayer(f);
    expect((await api(f).patch(`/players/${player.id}`).send({})).status).toBe(400);
  });

  it('refuses changing the date of birth or the club, which are not offered', async () => {
    const f = floor();
    const { player } = await aClubWithPlayer(f);
    expect(
      (await api(f).patch(`/players/${player.id}`).send({ bornOn: '2004-01-01' })).status,
    ).toBe(400);
    expect((await api(f).patch(`/players/${player.id}`).send({ clubId: 2 })).status).toBe(400);
  });

  it('will not change a released player', async () => {
    const f = floor();
    const { player } = await aClubWithPlayer(f);
    await api(f).post(`/players/${player.id}/release`).send({ releasedOn: '2031-09-01' });
    expect((await api(f).patch(`/players/${player.id}`).send({ position: 'forward' })).status).toBe(
      409,
    );
  });
});

describe('who may settle a player', () => {
  it('needs a token on every player route', async () => {
    const f = floor();
    const { club, player } = await aClubWithPlayer(f);
    expect((await bare(f).post(`/clubs/${club.id}/players`).send(playerBody())).status).toBe(401);
    expect((await bare(f).get(`/clubs/${club.id}/players`)).status).toBe(401);
    expect((await bare(f).get('/players')).status).toBe(401);
    expect((await bare(f).get(`/players/${player.id}`)).status).toBe(401);
    expect(
      (await bare(f).patch(`/players/${player.id}`).send({ position: 'forward' })).status,
    ).toBe(401);
    expect(
      (await bare(f).post(`/players/${player.id}/release`).send({ releasedOn: '2031-09-01' }))
        .status,
    ).toBe(401);
    expect(
      (
        await bare(f)
          .post(`/players/${player.id}/transfer`)
          .send({ clubId: 2, transferredOn: '2031-08-15', squadNumber: 21 })
      ).status,
    ).toBe(401);
  });

  it('lets a registrar register a player but stops a discipline officer', async () => {
    const f = floor();
    const club = await aMemberClub(f);
    const registrar = staffWith(f, 'registrar', 'reg-player@touchline.example');
    const officer = staffWith(f, 'discipline', 'disc-player@touchline.example');
    expect(
      (await api(f, registrar).post(`/clubs/${club.id}/players`).send(playerBody())).status,
    ).toBe(201);
    expect(
      (
        await api(f, officer)
          .post(`/clubs/${club.id}/players`)
          .send(playerBody({ squadNumber: 9 }))
      ).status,
    ).toBe(409);
    expect((await api(f, officer).get('/players')).status).toBe(200);
  });
});

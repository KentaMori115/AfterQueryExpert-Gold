import request from 'supertest';
import { floor } from './helpers';

describe('the service itself', () => {
  it('answers that it is up', async () => {
    const { app } = floor();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('answers 404 for a path it does not serve', async () => {
    const { app } = floor();
    const res = await request(app).get('/nothing-here');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ApiError, describeError, isApiError, messageFor } from '@/data/http';
import { captureApiError, failingClient, jsonResponse, stubClient } from '@tests/support/http';

const schema = z.object({ id: z.string(), value: z.number() });

describe('successful requests', () => {
  it('parses the payload against the schema', async () => {
    const { client } = stubClient(jsonResponse({ id: 'pen-3', value: 3 }));
    expect(await client.request('/pens', { schema })).toEqual({ id: 'pen-3', value: 3 });
  });

  it('joins the base url and the path without doubling the slash', async () => {
    const stub = stubClient(jsonResponse({ id: 'a', value: 1 }));
    await stub.client.request('/pens', { schema });
    expect(stub.urlFor()).toBe('https://netpen.test/api/pens');
  });

  it('accepts a path with no leading slash', async () => {
    const stub = stubClient(jsonResponse({ id: 'a', value: 1 }));
    await stub.client.request('pens', { schema });
    expect(stub.urlFor()).toBe('https://netpen.test/api/pens');
  });

  it('sends a json body with the matching content type', async () => {
    const stub = stubClient(jsonResponse({ id: 'a', value: 1 }));
    await stub.client.request('/counts', { method: 'POST', body: { adultFemale: 3 }, schema });
    const init = stub.initFor();
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"adultFemale":3}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('omits the content type when there is no body', async () => {
    const stub = stubClient(jsonResponse({ id: 'a', value: 1 }));
    await stub.client.request('/pens', { schema });
    expect((stub.initFor().headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });
});

describe('the link being down', () => {
  it('refuses before touching the network', async () => {
    const stub = stubClient(jsonResponse({ id: 'a', value: 1 }), { isOnline: () => false });
    const error = await captureApiError(stub.client.request('/pens', { schema }));
    expect(error.kind).toBe('offline');
    expect(stub.fetchMock).not.toHaveBeenCalled();
  });

  it('says so in words a crew member can act on', async () => {
    expect(messageFor('offline')).toContain('send when the connection is back');
  });

  it('is retryable and worth queueing', () => {
    const offline = new ApiError('offline', messageFor('offline'));
    expect(offline.isRetryable).toBe(true);
    expect(offline.isQueueable).toBe(true);
  });

  it('treats a fetch failure while nominally online as a server problem', async () => {
    const { client } = failingClient(new TypeError('failed to fetch'));
    expect((await captureApiError(client.request('/pens', { schema }))).kind).toBe('server');
  });

  it('treats the same failure as offline when the link is known to be down', async () => {
    let online = true;
    const { client } = failingClient(new TypeError('failed to fetch'), {
      isOnline: () => online,
    });
    online = true;
    const promise = client.request('/pens', { schema });
    online = false;
    expect((await captureApiError(promise)).kind).toBe('offline');
  });
});

describe('status mapping', () => {
  const cases: readonly (readonly [number, string])[] = [
    [401, 'unauthorised'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [409, 'conflict'],
    [422, 'validation'],
    [408, 'timeout'],
    [504, 'timeout'],
    [500, 'server'],
  ];

  for (const [status, kind] of cases) {
    it(`maps ${status} to ${kind}`, async () => {
      const { client } = stubClient(jsonResponse({ message: 'no' }, status));
      await expect(client.request('/pens', { schema })).rejects.toMatchObject({ kind, status });
    });
  }

  it('carries the server message as the detail', async () => {
    const { client } = stubClient(jsonResponse({ message: 'count already filed' }, 409));
    await expect(client.request('/counts', { schema })).rejects.toMatchObject({
      detail: 'count already filed',
    });
  });

  it('does not queue a refusal', () => {
    expect(new ApiError('forbidden', 'no').isQueueable).toBe(false);
    expect(new ApiError('conflict', 'no').isRetryable).toBe(false);
  });
});

describe('malformed responses', () => {
  it('reports unreadable json', async () => {
    const { client } = stubClient(new Response('not json', { status: 200 }));
    expect((await captureApiError(client.request('/pens', { schema }))).kind).toBe(
      'malformed-response',
    );
  });

  it('names the field that did not match', async () => {
    const { client } = stubClient(jsonResponse({ id: 'a', value: 'three' }));
    const error = await captureApiError(client.request('/pens', { schema }));
    expect(error.detail).toContain('value');
    expect(error.isRetryable).toBe(false);
  });
});

describe('describing an error', () => {
  it('prefers the api message', () => {
    const error = new ApiError('forbidden', messageFor('forbidden'));
    expect(isApiError(error)).toBe(true);
    expect(describeError(error)).toBe('You do not have access to this');
  });

  it('falls back for anything else', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('a string')).toBe('Something went wrong');
  });
});

import { describe, expect, it, vi } from 'vitest';

import { discardGuard, fileQuietly } from '@/views/recording';

describe('the discard guard', () => {
  it('closes without asking when nothing has been entered', () => {
    const confirm = vi.fn(() => true);
    const guard = discardGuard(() => false, 'Lose it?', confirm);

    expect(guard()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks before losing work, and takes no for an answer', () => {
    const confirm = vi.fn(() => false);
    const guard = discardGuard(() => true, 'Lose it?', confirm);

    expect(guard()).toBe(false);
    expect(confirm).toHaveBeenCalledWith('Lose it?');
  });

  it('closes when the question is answered yes', () => {
    expect(
      discardGuard(
        () => true,
        'Lose it?',
        () => true,
      )(),
    ).toBe(true);
  });

  it('reads the entry afresh each time, not once when it was built', () => {
    let entered = false;
    const confirm = vi.fn(() => false);
    const guard = discardGuard(() => entered, 'Lose it?', confirm);

    expect(guard()).toBe(true);
    entered = true;
    expect(guard()).toBe(false);
  });
});

describe('filing quietly', () => {
  it('says it landed when the write succeeds', async () => {
    expect(await fileQuietly(() => Promise.resolve({ id: 'count-1' }))).toEqual({ filed: true });
  });

  it('says it did not when the write is refused, without throwing', async () => {
    expect(await fileQuietly(() => Promise.reject(new Error('refused')))).toEqual({ filed: false });
  });

  it('swallows a rejection that is not an error at all', async () => {
    expect(await fileQuietly(() => Promise.reject('offline'))).toEqual({ filed: false });
  });

  it('catches a write that throws before it returns a promise', async () => {
    expect(
      await fileQuietly(() => {
        throw new Error('nothing to send');
      }),
    ).toEqual({ filed: false });
  });

  it('runs the write once and only once', async () => {
    const write = vi.fn(() => Promise.resolve(null));
    await fileQuietly(write);
    expect(write).toHaveBeenCalledTimes(1);
  });
});

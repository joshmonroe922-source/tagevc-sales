import { describe, expect, it } from 'vitest';

import {
  ACCESS_TOKEN_EXPIRY_SECONDS,
  isSessionTimeoutError,
} from './session-timeout';

describe('session timeout', () => {
  it('treats auth and stale-tab failures as a timeout', () => {
    expect(isSessionTimeoutError({ message: 'JWT expired' })).toBe(true);
    expect(isSessionTimeoutError({ message: 'Auth session missing!' })).toBe(true);
    expect(
      isSessionTimeoutError({ name: 'ChunkLoadError', message: 'Loading chunk 12 failed' }),
    ).toBe(true);
  });

  it('does not label an unrelated render bug as a timeout', () => {
    expect(
      isSessionTimeoutError({ message: 'Cannot read properties of undefined' }),
    ).toBe(false);
  });

  it('documents the 1-hour access token', () => {
    expect(ACCESS_TOKEN_EXPIRY_SECONDS).toBe(3600);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

/**
 * Mirror allowlist logic from portal-return-banner (pure URL check).
 * Kept as a unit test so handoff hosts stay intentional.
 */
const ALLOWED_RETURN_HOSTS = new Set([
  'portal.recruit619.com',
  'portal.instantnda.com',
  'localhost',
  '127.0.0.1',
]);

function safeReturnHref(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (
      url.protocol === 'http:' &&
      url.hostname !== 'localhost' &&
      url.hostname !== '127.0.0.1'
    ) {
      return null;
    }
    if (!ALLOWED_RETURN_HOSTS.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

describe('portal return_to allowlist', () => {
  it('allows Recruit portal https', () => {
    assert.equal(
      safeReturnHref('https://portal.recruit619.com/my-day'),
      'https://portal.recruit619.com/my-day',
    );
  });

  it('rejects foreign hosts', () => {
    assert.equal(safeReturnHref('https://evil.example/phish'), null);
  });

  it('rejects javascript URLs', () => {
    assert.equal(safeReturnHref('javascript:alert(1)'), null);
  });
});

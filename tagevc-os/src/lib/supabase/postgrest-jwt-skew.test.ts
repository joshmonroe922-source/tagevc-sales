import { describe, expect, it } from 'vitest';

import {
  applyServiceRoleAuth,
  authorizationFrom,
  createPostgrestJwtSkewFetch,
  decodeJwtIat,
  isAuthUrl,
  isJwtSkewMessage,
  isPostgrestDataUrl,
  jwtSkewMitigationEnabled,
  msUntilJwtIatReady,
  parseIssuedAtFutureWaitMs,
} from './postgrest-jwt-skew';

function jwtWithIat(iat: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
    'base64url',
  );
  const payload = Buffer.from(JSON.stringify({ iat, sub: 'user' })).toString(
    'base64url',
  );
  return `${header}.${payload}.sig`;
}

describe('postgrest-jwt-skew', () => {
  it('detects skew error text', () => {
    expect(isJwtSkewMessage('JWT issued at future')).toBe(true);
    expect(isJwtSkewMessage('JWT issued at future by 35 seconds')).toBe(true);
    expect(isJwtSkewMessage('PGRST303')).toBe(true);
    expect(isJwtSkewMessage('permission denied')).toBe(false);
  });

  it('parses PostgREST "by N seconds" wait', () => {
    expect(parseIssuedAtFutureWaitMs('JWT issued at future by 35 seconds')).toBe(36_000);
    expect(parseIssuedAtFutureWaitMs('JWT issued at future')).toBeGreaterThanOrEqual(8_000);
  });

  it('waits until iat plus leeway', () => {
    expect(msUntilJwtIatReady(100, 100_000, 2_000, 15_000)).toBe(2_000);
    expect(msUntilJwtIatReady(100, 102_000, 2_000, 15_000)).toBe(0);
    expect(msUntilJwtIatReady(200, 100_000, 2_000, 15_000)).toBe(15_000);
  });

  it('decodes iat from Authorization bearer', () => {
    const token = jwtWithIat(1_700_000_000);
    expect(decodeJwtIat(`Bearer ${token}`)).toBe(1_700_000_000);
    expect(decodeJwtIat(null)).toBeNull();
  });

  it('retries fetch when response looks like skew', async () => {
    const prev = process.env.R619_DISABLE_JWT_SKEW_MITIGATION;
    const prevRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.R619_DISABLE_JWT_SKEW_MITIGATION;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    let calls = 0;
    const inner = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(
          JSON.stringify({
            code: 'PGRST303',
            message: 'JWT issued at future by 0 seconds',
          }),
          { status: 401 },
        );
      }
      return new Response('ok', { status: 200 });
    };
    const wrapped = createPostgrestJwtSkewFetch(inner as typeof fetch);
    const res = await wrapped('https://example.test/rest/v1/profiles', {
      headers: { Authorization: `Bearer ${jwtWithIat(Math.floor(Date.now() / 1000) - 60)}` },
    });
    expect(res.status).toBe(200);
    expect(calls).toBeGreaterThanOrEqual(2);
    if (prev === undefined) delete process.env.R619_DISABLE_JWT_SKEW_MITIGATION;
    else process.env.R619_DISABLE_JWT_SKEW_MITIGATION = prev;
    if (prevRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevRole;
  });

  it('respects disable flag', () => {
    const prev = process.env.R619_DISABLE_JWT_SKEW_MITIGATION;
    process.env.R619_DISABLE_JWT_SKEW_MITIGATION = '1';
    expect(jwtSkewMitigationEnabled()).toBe(false);
    if (prev === undefined) delete process.env.R619_DISABLE_JWT_SKEW_MITIGATION;
    else process.env.R619_DISABLE_JWT_SKEW_MITIGATION = prev;
  });

  it('classifies PostgREST data URLs only', () => {
    expect(isPostgrestDataUrl('https://x.supabase.co/rest/v1/jobs')).toBe(true);
    expect(isPostgrestDataUrl('https://x.supabase.co/storage/v1/object')).toBe(true);
    expect(isPostgrestDataUrl('https://x.supabase.co/auth/v1/user')).toBe(false);
    expect(isAuthUrl('https://x.supabase.co/auth/v1/token')).toBe(true);
    expect(isAuthUrl('https://x.supabase.co/rest/v1/jobs')).toBe(false);
  });

  it('does not wait or retry Auth URLs', async () => {
    let calls = 0;
    const inner = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          code: 'PGRST303',
          message: 'JWT issued at future by 35 seconds',
        }),
        { status: 401 },
      );
    };
    const wrapped = createPostgrestJwtSkewFetch(inner as typeof fetch);
    const started = Date.now();
    const res = await wrapped('https://example.test/auth/v1/token', {
      headers: { Authorization: `Bearer ${jwtWithIat(Math.floor(Date.now() / 1000) + 30)}` },
    });
    expect(res.status).toBe(401);
    expect(calls).toBe(1);
    expect(Date.now() - started).toBeLessThan(250);
  });

  it('reads Authorization from Request when init has none', () => {
    const req = new Request('https://x.supabase.co/rest/v1/jobs', {
      headers: { Authorization: 'Bearer from-request' },
    });
    expect(authorizationFrom(req)).toBe('Bearer from-request');
  });

  it('retries PostgREST skew with the service-role key', async () => {
    const prevFlag = process.env.R619_DISABLE_JWT_SKEW_MITIGATION;
    const prevRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.R619_DISABLE_JWT_SKEW_MITIGATION;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sr-test-key';
    const auths: Array<string | null> = [];
    const inner = async (_input: RequestInfo | URL, init?: RequestInit) => {
      auths.push(new Headers(init?.headers).get('Authorization'));
      if (auths.length === 1) {
        return new Response(
          JSON.stringify({ code: 'PGRST303', message: 'JWT issued at future' }),
          { status: 401 },
        );
      }
      return new Response('ok', { status: 200 });
    };
    const wrapped = createPostgrestJwtSkewFetch(inner as typeof fetch);
    const res = await wrapped('https://example.test/rest/v1/jobs', {
      headers: { Authorization: `Bearer ${jwtWithIat(Math.floor(Date.now() / 1000) - 60)}` },
    });
    expect(res.status).toBe(200);
    expect(auths[1]).toBe('Bearer sr-test-key');
    if (prevFlag === undefined) delete process.env.R619_DISABLE_JWT_SKEW_MITIGATION;
    else process.env.R619_DISABLE_JWT_SKEW_MITIGATION = prevFlag;
    if (prevRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevRole;
  });

  it('rewrites Request headers for service role', () => {
    const req = new Request('https://x.supabase.co/rest/v1/jobs', {
      headers: { Authorization: 'Bearer user', apikey: 'anon' },
    });
    const swapped = applyServiceRoleAuth(req, undefined, 'sr-key');
    expect(swapped.input).toBeInstanceOf(Request);
    expect((swapped.input as Request).headers.get('Authorization')).toBe(
      'Bearer sr-key',
    );
  });
});

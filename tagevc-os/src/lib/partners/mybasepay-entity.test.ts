import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalizeMyBasePayEntityId,
  isMyBasePayLive,
  resolveMyBasePayEntityFromEnv,
} from '@/lib/partners/mybasepay-entity';
import {
  clearMyBasePaySessionCache,
  mybasepayCreateWorker,
} from '@/lib/partners/mybasepay-admin';
import { runPartnerLifecycleHook } from '@/lib/partners/adapters';

const KEYS = [
  'MYBASEPAY_LIVE',
  'MYBASEPAY_ALLOW_CREATE',
  'MYBASEPAY_ADMIN_EMAIL',
  'MYBASEPAY_ADMIN_PASSWORD',
  'MYBASEPAY_API_KEY',
  'MYBASEPAY_API_BASE',
  'MYBASEPAY_BASE_URL',
  'MYBASEPAY_EXTERNAL_ACCOUNT_ID',
  'MYBASEPAY_EXTERNAL_ACCOUNT_ID_R619',
  'MYBASEPAY_WEBHOOK_SECRET',
];

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
  clearMyBasePaySessionCache();
  vi.restoreAllMocks();
});

describe('resolveMyBasePayEntity (fail-closed)', () => {
  it('allows ENT-R619 and rejects firm/unknown', () => {
    expect(canonicalizeMyBasePayEntityId('ENT-R619')).toBe('ENT-R619');
    expect(canonicalizeMyBasePayEntityId('ENT-FIRM')).toBeNull();
    expect(canonicalizeMyBasePayEntityId('ENT-SIGNENT')).toBeNull();
  });

  it('resolves R619 external id from env without firm borrow', () => {
    process.env.MYBASEPAY_EXTERNAL_ACCOUNT_ID_R619 = 'r619-mbp-member';
    process.env.MYBASEPAY_ADMIN_EMAIL = 'admin@example.com';
    process.env.MYBASEPAY_ADMIN_PASSWORD = 'secret';

    const r619 = resolveMyBasePayEntityFromEnv('ENT-R619');
    expect(r619.allowed).toBe(true);
    expect(r619.ready).toBe(true);
    expect(r619.externalAccountId).toBe('r619-mbp-member');
    expect(r619.adminCredentialsReady).toBe(true);
    expect(r619.credentialsReady).toBe(true);

    const firm = resolveMyBasePayEntityFromEnv('ENT-FIRM');
    expect(firm.allowed).toBe(false);
    expect(firm.credentialsReady).toBe(false);
    expect(firm.externalAccountId).toBeNull();
  });

  it('live flag stay false unless exactly 1', () => {
    process.env.MYBASEPAY_LIVE = '0';
    expect(isMyBasePayLive()).toBe(false);
    process.env.MYBASEPAY_LIVE = '1';
    expect(isMyBasePayLive()).toBe(true);
  });
});

describe('mybasepay create worker gates', () => {
  it('dry-runs when LIVE off even with admin creds', async () => {
    process.env.MYBASEPAY_LIVE = '0';
    process.env.MYBASEPAY_ADMIN_EMAIL = 'admin@example.com';
    process.env.MYBASEPAY_ADMIN_PASSWORD = 'secret';
    process.env.MYBASEPAY_EXTERNAL_ACCOUNT_ID_R619 = 'mbp-r619';

    const result = await mybasepayCreateWorker({
      entityId: 'ENT-R619',
      firstName: 'Test',
      lastName: 'Worker',
      email: 'test@example.com',
      phone: '5555555555',
      workerType: 'IC',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dryRun).toBe(true);
      expect(result.status).toBe('dry_run');
      expect(result.message).toMatch(/MYBASEPAY_LIVE/);
    }
  });

  it('refuses non-R619 entity', async () => {
    process.env.MYBASEPAY_LIVE = '0';
    process.env.MYBASEPAY_ADMIN_EMAIL = 'admin@example.com';
    process.env.MYBASEPAY_ADMIN_PASSWORD = 'secret';
    const result = await mybasepayCreateWorker({
      entityId: 'ENT-FIRM',
      firstName: 'Nope',
      lastName: 'Firm',
      email: 'nope@example.com',
      phone: '5555555555',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not allow-listed/);
    }
  });

  it('LIVE without ALLOW_CREATE fails closed', async () => {
    process.env.MYBASEPAY_LIVE = '1';
    process.env.MYBASEPAY_ADMIN_EMAIL = 'admin@example.com';
    process.env.MYBASEPAY_ADMIN_PASSWORD = 'secret';
    process.env.MYBASEPAY_EXTERNAL_ACCOUNT_ID_R619 = 'mbp-r619';

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      // Login must include applicationType=2 (Backoffice).
      if (body && typeof body === 'object' && 'email' in body) {
        expect(body.applicationType).toBe(2);
      }
      return new Response(
        JSON.stringify({
          token: 'fake-jwt-for-unit-test',
          expireDate: '2099-01-01T00:00:00Z',
          authCode: null,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await mybasepayCreateWorker({
      entityId: 'ENT-R619',
      firstName: 'Test',
      lastName: 'Worker',
      email: 'test@example.com',
      phone: '5555555555',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/MYBASEPAY_ALLOW_CREATE/);
    }
  });

  it('lifecycle smoke hook dry-runs via adapters', async () => {
    process.env.MYBASEPAY_LIVE = '0';
    process.env.MYBASEPAY_ADMIN_EMAIL = 'admin@example.com';
    process.env.MYBASEPAY_ADMIN_PASSWORD = 'secret';
    const result = await runPartnerLifecycleHook(
      'enable_mybasepay_if_recruiting',
      { entityId: 'ENT-R619', email: 'worker@example.com' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dryRun).toBe(true);
      expect(result.message).toMatch(/admin bridge configured|MYBASEPAY_LIVE/);
    }
  });

  it('ensure binding hook acknowledges R619', async () => {
    process.env.MYBASEPAY_LIVE = '0';
    process.env.MYBASEPAY_EXTERNAL_ACCOUNT_ID_R619 = 'Recruit 619';
    process.env.MYBASEPAY_ADMIN_EMAIL = 'admin@example.com';
    process.env.MYBASEPAY_ADMIN_PASSWORD = 'secret';
    const result = await runPartnerLifecycleHook(
      'ensure_mybasepay_account_binding',
      { entityId: 'ENT-R619' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.externalRef).toBe('Recruit 619');
      expect(result.dryRun).toBe(true);
    }
  });
});

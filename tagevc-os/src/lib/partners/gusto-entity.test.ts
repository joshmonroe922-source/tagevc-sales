import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractGustoCompanyUuidFromPayload,
  gustoEntityMappingReadyFromEnv,
  resolveGustoCompanyFromEnv,
} from '@/lib/partners/gusto-entity';
import { runPartnerLifecycleHook } from '@/lib/partners/adapters';

const KEYS = [
  'GUSTO_LIVE',
  'GUSTO_API_TOKEN',
  'GUSTO_ACCESS_TOKEN',
  'GUSTO_COMPANY_UUID',
  'GUSTO_COMPANY_UUID_FIRM',
  'GUSTO_COMPANY_UUID_R619',
  'GUSTO_COMPANY_UUID_SIGNENT',
  'GUSTO_COMPANY_UUID_INDA',
  'GUSTO_ACCESS_TOKEN_FIRM',
  'GUSTO_ACCESS_TOKEN_R619',
  'GUSTO_ACCESS_TOKEN_SIGNENT',
  'GUSTO_ACCESS_TOKEN_INDA',
  'GUSTO_API_TOKEN_FIRM',
  'GUSTO_API_TOKEN_R619',
];

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
  vi.restoreAllMocks();
});

describe('resolveGustoCompany (fail-closed)', () => {
  it('resolves per-entity env for R619 without using firm globals', () => {
    process.env.GUSTO_COMPANY_UUID = 'firm-global-uuid';
    process.env.GUSTO_API_TOKEN = 'firm-global-token';
    process.env.GUSTO_COMPANY_UUID_R619 = 'r619-company-uuid';
    process.env.GUSTO_ACCESS_TOKEN_R619 = 'r619-token';

    const r619 = resolveGustoCompanyFromEnv('ENT-R619');
    expect(r619.ready).toBe(true);
    expect(r619.companyUuid).toBe('r619-company-uuid');
    expect(r619.accessToken).toBe('r619-token');
    expect(r619.source).toBe('env_entity');
    expect(r619.tokenSource).toBe('env_entity');
    expect(r619.credentialsReady).toBe(true);

    const firm = resolveGustoCompanyFromEnv('ENT-FIRM');
    expect(firm.companyUuid).toBe('firm-global-uuid');
    expect(firm.accessToken).toBe('firm-global-token');
    expect(firm.source).toBe('env_default');
  });

  it('never falls back to firm company UUID for subsidiaries', () => {
    process.env.GUSTO_COMPANY_UUID = 'firm-only-uuid';
    process.env.GUSTO_API_TOKEN = 'firm-only-token';

    const r619 = resolveGustoCompanyFromEnv('ENT-R619');
    expect(r619.ready).toBe(false);
    expect(r619.companyUuid).toBeNull();
    expect(r619.accessToken).toBeNull();
    expect(r619.source).toBe('missing');
    expect(r619.credentialsReady).toBe(false);

    const signent = resolveGustoCompanyFromEnv('ENT-SIGNENT');
    expect(signent.companyUuid).toBeNull();
    expect(signent.accessToken).toBeNull();
  });

  it('allows firm legacy globals only for ENT-FIRM', () => {
    process.env.GUSTO_COMPANY_UUID = 'firm-uuid';
    process.env.GUSTO_API_TOKEN = 'firm-token';
    const firm = resolveGustoCompanyFromEnv('ENT-FIRM');
    expect(firm.credentialsReady).toBe(true);
    expect(firm.companyUuid).toBe('firm-uuid');
  });

  it('reports mapping gaps from env', () => {
    process.env.GUSTO_COMPANY_UUID_FIRM = 'firm';
    const ready = gustoEntityMappingReadyFromEnv();
    expect(ready.ready).toBe(false);
    expect(ready.missing).toContain('ENT-R619');
    expect(ready.mapped).toBe(1);
  });

  it('extracts company UUID from webhook payloads', () => {
    expect(
      extractGustoCompanyUuidFromPayload({
        company_uuid: 'abc-123',
      }),
    ).toBe('abc-123');
    expect(
      extractGustoCompanyUuidFromPayload({
        company: { uuid: 'company-from-nested' },
      }),
    ).toBe('company-from-nested');
    expect(extractGustoCompanyUuidFromPayload({ id: 'event-only' })).toBeNull();
  });
});

describe('gusto adapters fail-closed', () => {
  it('dry-run R619 hire does not claim firm company', async () => {
    process.env.GUSTO_LIVE = '0';
    process.env.GUSTO_COMPANY_UUID = 'FIRM-UUID-DO-NOT-USE';
    process.env.GUSTO_API_TOKEN = 'FIRM-TOKEN-DO-NOT-USE';
    process.env.GUSTO_COMPANY_UUID_R619 = 'R619-UUID';

    const result = await runPartnerLifecycleHook('provision_gusto_employee', {
      entityId: 'ENT-R619',
      email: 'hire@recruit619.com',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dryRun).toBe(true);
      expect(result.status).toBe('dry_run');
      expect(result.message).toContain('R619-UUID');
      expect(result.message).not.toContain('FIRM-UUID-DO-NOT-USE');
      expect(result.externalRef).toBe('R619-UUID');
    }
  });

  it('LIVE without entity binding fails closed (no firm borrow)', async () => {
    process.env.GUSTO_LIVE = '1';
    process.env.GUSTO_COMPANY_UUID = 'FIRM-UUID';
    process.env.GUSTO_API_TOKEN = 'FIRM-TOKEN';

    const result = await runPartnerLifecycleHook('provision_gusto_employee', {
      entityId: 'ENT-R619',
      email: 'hire@recruit619.com',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe('failed');
      expect(result.error).toMatch(/refuse firm fallback|missing company/i);
      expect(result.error).not.toContain('FIRM-UUID');
    }
  });

  it('ensure_gusto_company_binding dry-runs mapped R619 UUID', async () => {
    process.env.GUSTO_LIVE = '0';
    process.env.GUSTO_COMPANY_UUID_R619 = 'r619-bound';
    const result = await runPartnerLifecycleHook(
      'ensure_gusto_company_binding',
      { entityId: 'ENT-R619' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain('r619-bound');
      expect(result.externalRef).toBe('r619-bound');
    }
  });
});

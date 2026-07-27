import { describe, expect, it } from 'vitest';
import {
  getIesConfig,
  IES_OPERATING_ENTITIES,
  IES_SCOPE,
  PHASE70_IES_CONTRACT_VERSION,
} from './config';
import { canStoreIesTokens, decryptIesSecret, encryptIesSecret } from './crypto';
import {
  IES_COMPANY_MAP,
  iesCompanySelectOrder,
  resolveIesCompanyByEntity,
} from './company-map';
import { evaluateIesSubmission, isSafeIesProposal } from './write-proposals';

describe('IES company map (authoritative)', () => {
  it('resolves all four companies with parent flag and locked digit IDs', () => {
    expect(IES_COMPANY_MAP).toHaveLength(4);
    expect(resolveIesCompanyByEntity('ENT-FIRM')).toMatchObject({
      ies_company_id: '9341457251412290',
      display_name: 'Tage Venture Capital',
      is_parent: true,
    });
    expect(resolveIesCompanyByEntity('ENT-R619')?.ies_company_id).toBe(
      '9341457251406251',
    );
    expect(resolveIesCompanyByEntity('ENT-SIGNENT')?.ies_company_id).toBe(
      '9341457251424506',
    );
    expect(resolveIesCompanyByEntity('ENT-INDA')?.ies_company_id).toBe(
      '9341457533727282',
    );
    expect(iesCompanySelectOrder().map((r) => r.display_name)).toEqual([
      'Tage Venture Capital',
      'Recruit 619',
      'Signent HR',
      'Instant NDA',
    ]);
    for (const row of IES_COMPANY_MAP) {
      expect(row.ies_company_id).toMatch(/^\d+$/);
      expect(row.display_name).not.toMatch(/^ENT-/);
    }
  });
});

describe('IES config', () => {
  it('exposes operating entities and contract version', () => {
    expect(IES_OPERATING_ENTITIES).toContain('ENT-FIRM');
    expect(IES_OPERATING_ENTITIES).toContain('ENT-R619');
    expect(IES_OPERATING_ENTITIES).toContain('ENT-INDA');
    expect(IES_OPERATING_ENTITIES).toContain('ENT-SIGNENT');
    expect(PHASE70_IES_CONTRACT_VERSION).toBe('phase70-v1');
    expect(IES_SCOPE).toContain('quickbooks.accounting');
  });

  it('fail-soft reports missing secrets without throwing', () => {
    const cfg = getIesConfig();
    expect(cfg).toHaveProperty('configured');
    expect(Array.isArray(cfg.missing)).toBe(true);
    expect(cfg.redirectUri).toContain('/api/finance/ies/oauth/callback');
  });
});

describe('IES write proposal boundary', () => {
  it('fails closed when IES_WRITE_ENABLED is off', () => {
    expect(
      evaluateIesSubmission({
        writeEnabled: false,
        status: 'approved',
        proposerId: 'human-1',
        approverIds: ['human-2', 'human-3'],
        proposalType: 'journal_draft',
        payload: { memo: 'manual management fee draft' },
      }),
    ).toEqual({
      ok: false,
      error: 'IES_WRITE_ENABLED is not exactly 1',
    });
  });

  it('requires two distinct humans and rejects money actions', () => {
    expect(
      evaluateIesSubmission({
        writeEnabled: true,
        status: 'approved',
        proposerId: 'human-1',
        approverIds: ['human-2', 'human-2'],
        proposalType: 'journal_draft',
        payload: { memo: 'allocation draft' },
      }).ok,
    ).toBe(false);
    expect(
      isSafeIesProposal({
        proposalType: 'journal_draft',
        payload: { action: 'transfer' },
      }),
    ).toBe(false);
  });
});

describe('IES crypto', () => {
  it('round-trips when IES_TOKEN_SECRET is set', () => {
    const prev = process.env.IES_TOKEN_SECRET;
    process.env.IES_TOKEN_SECRET = 'test-ies-token-secret-32chars!!';
    try {
      expect(canStoreIesTokens()).toBe(true);
      const blob = encryptIesSecret('access-token-value');
      expect(blob).toBeTruthy();
      expect(decryptIesSecret(blob!)).toBe('access-token-value');
    } finally {
      if (prev === undefined) delete process.env.IES_TOKEN_SECRET;
      else process.env.IES_TOKEN_SECRET = prev;
    }
  });

  it('refuses store when vault secret missing', () => {
    const prev = process.env.IES_TOKEN_SECRET;
    delete process.env.IES_TOKEN_SECRET;
    try {
      expect(canStoreIesTokens()).toBe(false);
      expect(encryptIesSecret('x')).toBeNull();
    } finally {
      if (prev !== undefined) process.env.IES_TOKEN_SECRET = prev;
    }
  });
});

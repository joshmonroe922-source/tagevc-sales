import { describe, expect, it } from 'vitest';
import {
  getIesConfig,
  IES_OPERATING_ENTITIES,
  IES_SCOPE,
  PHASE70_IES_CONTRACT_VERSION,
} from './config';
import { canStoreIesTokens, decryptIesSecret, encryptIesSecret } from './crypto';

describe('IES config', () => {
  it('exposes operating entities and contract version', () => {
    expect(IES_OPERATING_ENTITIES).toContain('ENT-FIRM');
    expect(IES_OPERATING_ENTITIES).toContain('ENT-R619');
    expect(IES_OPERATING_ENTITIES).toContain('ENT-INDA');
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

import { afterEach, describe, expect, it } from 'vitest';
import {
  docusignEntityMappingReady,
  resolveDocuSignAccountId,
} from '@/lib/docusign/entity-accounts';

const KEYS = [
  'DOCUSIGN_ACCOUNT_ID',
  'DOCUSIGN_ACCOUNT_ID_FIRM',
  'DOCUSIGN_ACCOUNT_ID_R619',
  'DOCUSIGN_ACCOUNT_ID_SIGNENT',
  'DOCUSIGN_ACCOUNT_ID_INDA',
  'DOCUSIGN_INTEGRATION_KEY',
  'DOCUSIGN_USER_ID',
  'DOCUSIGN_PRIVATE_KEY',
];

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe('DocuSign entity accounts', () => {
  it('resolves per-entity env', () => {
    process.env.DOCUSIGN_ACCOUNT_ID_R619 = 'acct-r619';
    const row = resolveDocuSignAccountId('ENT-R619');
    expect(row.ready).toBe(true);
    expect(row.accountId).toBe('acct-r619');
    expect(row.source).toBe('env_entity');
  });

  it('reports missing until mapped', () => {
    const ready = docusignEntityMappingReady();
    expect(ready.ready).toBe(false);
    expect(ready.missing).toContain('ENT-SIGNENT');
  });
});

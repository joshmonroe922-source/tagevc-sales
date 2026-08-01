import { describe, expect, it } from 'vitest';
import {
  HRIS_OPERATING_ENTITY_IDS,
  SIGNENT_HRIS_MODEL,
  hrisAudienceForEntity,
  hrisTenantMatchSqlHint,
  isHrisOperatingEntity,
  isSignentClientTenant,
} from '@/lib/hris/tenancy';

describe('hris tenancy', () => {
  it('includes Signent as an operating HRIS entity', () => {
    expect(HRIS_OPERATING_ENTITY_IDS).toContain('ENT-SIGNENT');
    expect(isHrisOperatingEntity('ENT-SIGNENT')).toBe(true);
    expect(hrisAudienceForEntity('ENT-SIGNENT')).toBe('signent');
  });

  it('segments Signent clients without inventing orgs', () => {
    const client = {
      kind: 'signent_client' as const,
      entityId: 'ENT-SIGNENT' as const,
      clientOrgId: '00000000-0000-4000-8000-000000000001',
    };
    expect(isSignentClientTenant(client)).toBe(true);
    expect(hrisTenantMatchSqlHint(client)).toEqual({
      entity_id: 'ENT-SIGNENT',
      client_org_id: client.clientOrgId,
    });
    expect(SIGNENT_HRIS_MODEL.segmentation).toContain('client_org_id');
  });
});

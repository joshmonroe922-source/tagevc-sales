import { afterEach, describe, expect, it } from 'vitest';
import {
  assertFlagEnabled,
  getIdentityFlags,
} from '@/lib/identity/flags';
import {
  validateCancelledHirePayload,
  validateRoleChangedPayload,
  validateUpdatedPayload,
} from '@/lib/identity/events';

describe('identity feature flags', () => {
  const keys = [
    'IDENTITY_JOINER_ENABLED',
    'IDENTITY_LEAVER_ENABLED',
    'IDENTITY_MOVER_ENABLED',
    'IDENTITY_SCIM_ENABLED',
    'IDENTITY_BYOD_ENABLED',
  ];
  const prior: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const k of keys) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  });

  function snapshot() {
    for (const k of keys) prior[k] = process.env[k];
  }

  it('defaults joiner/leaver on and scim off', () => {
    snapshot();
    for (const k of keys) delete process.env[k];
    const f = getIdentityFlags();
    expect(f.joiner).toBe(true);
    expect(f.leaver).toBe(true);
    expect(f.scim).toBe(false);
  });

  it('respects IDENTITY_JOINER_ENABLED=0', () => {
    snapshot();
    process.env.IDENTITY_JOINER_ENABLED = '0';
    expect(assertFlagEnabled('joiner').ok).toBe(false);
  });
});

describe('HRIS event validators (sheet 04 leftovers)', () => {
  it('validates role_changed', () => {
    const v = validateRoleChangedPayload({
      employee_id: 'e1',
      entity_id: 'ENT-FIRM',
      primary_role_id: 'ROLE-AE',
      effective_date: '2026-08-10',
    });
    expect(v.ok).toBe(true);
  });

  it('validates updated + cancelled', () => {
    expect(
      validateUpdatedPayload({ employee_id: 'e1', entity_id: 'ENT-R619' }).ok,
    ).toBe(true);
    expect(
      validateCancelledHirePayload({
        employee_id: 'e1',
        entity_id: 'ENT-R619',
        reason: 'rescinded',
      }).ok,
    ).toBe(true);
  });

  it('rejects role_changed without primary_role_id', () => {
    const v = validateRoleChangedPayload({
      employee_id: 'e1',
      entity_id: 'ENT-FIRM',
      effective_date: '2026-08-10',
    });
    expect(v.ok).toBe(false);
  });
});

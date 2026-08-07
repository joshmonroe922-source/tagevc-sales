import { describe, expect, it } from 'vitest';
import {
  assertWipeAllowed,
  isFullWipeAction,
} from '@/lib/identity/wipe-guard';

describe('BYOD wipe guard', () => {
  it('identifies full wipe actions', () => {
    expect(isFullWipeAction('intune.device.wipe')).toBe(true);
    expect(isFullWipeAction('factoryReset')).toBe(true);
    expect(isFullWipeAction('intune.byod.selective_wipe')).toBe(false);
  });

  it('blocks wipe for personal_byod', () => {
    const r = assertWipeAllowed({
      action: 'wipe',
      device_ownership: 'personal_byod',
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('byod_wipe_blocked');
  });

  it('blocks wipe for mam_only enrollment', () => {
    const r = assertWipeAllowed({
      action: 'intune.device.wipe',
      enrollment_type: 'mam_only',
    });
    expect(r.allowed).toBe(false);
  });

  it('allows wipe for company_owned', () => {
    const r = assertWipeAllowed({
      action: 'wipe',
      device_ownership: 'company_owned',
    });
    expect(r.allowed).toBe(true);
  });

  it('allows selective wipe always', () => {
    const r = assertWipeAllowed({
      action: 'intune.byod.selective_wipe',
      device_ownership: 'personal_byod',
    });
    expect(r.allowed).toBe(true);
  });
});

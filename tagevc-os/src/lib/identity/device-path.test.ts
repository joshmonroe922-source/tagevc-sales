import { describe, expect, it } from 'vitest';
import {
  assertNoHardwareForByod,
  resolveDevicePath,
} from '@/lib/identity/device-path';

describe('resolveDevicePath', () => {
  it('routes company_owned to company_mdm with hardware', () => {
    const r = resolveDevicePath({
      device_ownership: 'company_owned',
      device_preference: 'windows',
    });
    expect(r.ok).toBe(true);
    expect(r.device_path).toBe('company_mdm');
    expect(r.skip_hardware).toBe(false);
    expect(r.kit_snapshot.hardware).toBe(true);
  });

  it('routes personal_byod to byod_mam without hardware', () => {
    const r = resolveDevicePath({
      device_ownership: 'personal_byod',
      device_preference: 'ios',
    });
    expect(r.ok).toBe(true);
    expect(r.device_path).toBe('byod_mam');
    expect(r.skip_hardware).toBe(true);
    expect(assertNoHardwareForByod(r.device_path)).toBe(true);
  });

  it('holds when ownership unset', () => {
    const r = resolveDevicePath({ device_ownership: 'unset' });
    expect(r.needs_human).toBe(true);
    expect(r.device_path).toBe('none');
  });

  it('rejects BYOD when role forbids it', () => {
    const r = resolveDevicePath({
      device_ownership: 'personal_byod',
      role_byod_allowed: false,
    });
    expect(r.ok).toBe(false);
    expect(r.needs_human).toBe(true);
  });
});

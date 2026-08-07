/**
 * Dual device path resolution (sheet 07b).
 * company_owned → Autopilot/ADE + it_assets
 * personal_byod → MAM / byod_registrations (never hardware rows)
 */

import type {
  ByodEnforcement,
  DeviceOwnership,
  DevicePath,
  DevicePreference,
} from '@/lib/identity/types';

export type DevicePathInput = {
  device_ownership: DeviceOwnership | string;
  device_preference?: DevicePreference | string | null;
  byod_allowed?: boolean;
  role_byod_allowed?: boolean;
  entity_byod_allowed?: boolean;
  byod_enforcement_level?: ByodEnforcement | string | null;
};

export type DevicePathResult = {
  ok: boolean;
  device_path: DevicePath;
  ownership: 'company_owned' | 'personal_byod' | 'unset';
  byod_enforcement_level: ByodEnforcement | null;
  skip_hardware: boolean;
  needs_human?: boolean;
  reason?: string;
  kit_snapshot: Record<string, unknown>;
};

export function resolveDevicePath(input: DevicePathInput): DevicePathResult {
  const ownershipRaw = String(input.device_ownership || 'unset');
  const roleOk = input.role_byod_allowed !== false;
  const entityOk = input.entity_byod_allowed !== false;
  const byodAllowed = input.byod_allowed !== false && roleOk && entityOk;

  if (ownershipRaw === 'unset' || !ownershipRaw) {
    return {
      ok: false,
      device_path: 'none',
      ownership: 'unset',
      byod_enforcement_level: null,
      skip_hardware: true,
      needs_human: true,
      reason: 'device_ownership missing — hold case needs_human',
      kit_snapshot: { device_path: 'none', error: 'ownership_unset' },
    };
  }

  if (ownershipRaw === 'personal_byod' && !byodAllowed) {
    return {
      ok: false,
      device_path: 'none',
      ownership: 'personal_byod',
      byod_enforcement_level: null,
      skip_hardware: true,
      needs_human: true,
      reason: 'Role/entity forbids BYOD but personal_byod was selected',
      kit_snapshot: { device_path: 'none', error: 'byod_not_allowed' },
    };
  }

  if (ownershipRaw === 'personal_byod') {
    const enforcement =
      (input.byod_enforcement_level as ByodEnforcement) || 'mam_only';
    const path: DevicePath =
      enforcement === 'mam_only' ? 'byod_mam' : 'byod_mam_mdm';
    return {
      ok: true,
      device_path: path,
      ownership: 'personal_byod',
      byod_enforcement_level: enforcement,
      skip_hardware: true,
      kit_snapshot: {
        device_path: path,
        ownership: 'personal_byod',
        byod_enforcement_level: enforcement,
        hardware: false,
        welcome: 'byod',
        device_preference: input.device_preference ?? null,
      },
    };
  }

  if (ownershipRaw === 'company_owned') {
    return {
      ok: true,
      device_path: 'company_mdm',
      ownership: 'company_owned',
      byod_enforcement_level: null,
      skip_hardware: false,
      kit_snapshot: {
        device_path: 'company_mdm',
        ownership: 'company_owned',
        hardware: true,
        welcome: 'company',
        device_preference: input.device_preference ?? null,
      },
    };
  }

  return {
    ok: false,
    device_path: 'none',
    ownership: 'unset',
    byod_enforcement_level: null,
    skip_hardware: true,
    needs_human: true,
    reason: `Unknown device_ownership: ${ownershipRaw}`,
    kit_snapshot: { device_path: 'none', error: 'ownership_invalid' },
  };
}

/** Pure MAM must never create it_assets hardware rows (G-BYOD-ASSET). */
export function assertNoHardwareForByod(devicePath: DevicePath): boolean {
  return devicePath === 'byod_mam' || devicePath === 'byod_mam_mdm';
}

/**
 * G-BYOD-WIPE — intune-worker MUST reject factory wipe when ownership=personal_byod.
 * Audit action: byod_wipe_blocked
 */

import type { DeviceOwnership } from '@/lib/identity/types';

export type WipeGuardInput = {
  action: string;
  device_ownership?: DeviceOwnership | string | null;
  enrollment_type?: string | null;
};

export type WipeGuardResult =
  | { allowed: true }
  | {
      allowed: false;
      code: 'byod_wipe_blocked';
      reason: string;
    };

const FULL_WIPE_ACTIONS = new Set([
  'wipe',
  'factoryReset',
  'factory_reset',
  'intune.device.wipe',
  'wipeDevice',
  'cleanWindowsDevice',
]);

export function isFullWipeAction(action: string): boolean {
  const a = action.trim();
  return FULL_WIPE_ACTIONS.has(a) || FULL_WIPE_ACTIONS.has(a.toLowerCase());
}

export function assertWipeAllowed(input: WipeGuardInput): WipeGuardResult {
  if (!isFullWipeAction(input.action)) {
    return { allowed: true };
  }

  const ownership = String(input.device_ownership || '').toLowerCase();
  const enrollment = String(input.enrollment_type || '').toLowerCase();

  if (
    ownership === 'personal_byod' ||
    enrollment === 'mam_only' ||
    enrollment === 'company_portal_personal'
  ) {
    return {
      allowed: false,
      code: 'byod_wipe_blocked',
      reason:
        'Full wipe forbidden for personal_byod — use selective wipe / Retire only',
    };
  }

  return { allowed: true };
}

/** Allowed destructive actions on BYOD: selective wipe + retire only. */
export function byodAllowedRemoteActions(): string[] {
  return [
    'intune.byod.selective_wipe',
    'intune.byod.retire',
    'retire',
    'selectiveWipe',
    'wipeOfAppData',
  ];
}

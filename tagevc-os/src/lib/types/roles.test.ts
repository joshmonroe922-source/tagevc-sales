import { describe, expect, it } from 'vitest';
import {
  ROLE_PERMISSIONS,
  roleCanAccessModule,
  roleHasPermission,
} from '@/lib/types/roles';

/**
 * COO (Subsidiaries) access contract — Kelly Hipskind's role.
 * Nav hiding alone is not a boundary; these assert the permission layer so a
 * direct route hit is refused too.
 */
describe('COO (Subsidiaries) permission boundary', () => {
  it('has no Shared Services desk access', () => {
    expect(roleHasPermission('coo', 'read:shared_services')).toBe(false);
    expect(roleHasPermission('coo', 'write:shared_services')).toBe(false);
    expect(roleCanAccessModule('coo', 'shared_services')).toBe(false);
  });

  it('has no Firm access', () => {
    expect(roleHasPermission('coo', 'read:firm')).toBe(false);
    expect(roleCanAccessModule('coo', 'firm')).toBe(false);
    expect(roleHasPermission('coo', 'write:capital')).toBe(false);
  });

  it('has no Technology or Marketing desk access', () => {
    for (const perm of [
      'read:it_assets',
      'write:it_assets',
      'read:marketing',
      'write:marketing',
      'action:intune_retire',
      'action:intune_manual_review',
    ] as const) {
      expect(roleHasPermission('coo', perm)).toBe(false);
    }
  });

  it('has no admin, wire, or IC vote powers', () => {
    for (const perm of [
      'admin:users',
      'admin:enums',
      'action:wire',
      'action:ic_vote',
      'action:docusign_capital',
    ] as const) {
      expect(roleHasPermission('coo', perm)).toBe(false);
    }
  });

  it('has full Business Development pipelines', () => {
    for (const perm of [
      'read:vc_pipeline',
      'write:vc_pipeline',
      'read:ma_pipeline',
      'write:ma_pipeline',
      'read:re_pipeline',
      'write:re_pipeline',
    ] as const) {
      expect(roleHasPermission('coo', perm)).toBe(true);
    }
  });

  it('has Grow without inheriting Shared Services', () => {
    expect(roleCanAccessModule('coo', 'grow')).toBe(true);
    expect(roleCanAccessModule('coo', 'shared_services')).toBe(false);
  });

  it('keeps Assets and Home reachable', () => {
    expect(roleCanAccessModule('coo', 'portfolio')).toBe(true);
    // Home + My Networking Contacts ride on command_center; the section itself
    // is hidden in nav via hiddenForRoles.
    expect(roleCanAccessModule('coo', 'command_center')).toBe(true);
  });
});

describe('grow module rollout', () => {
  it('grants Grow to every role that already had Shared Services', () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      if (perms.includes('read:shared_services')) {
        expect(perms, `${role} should keep Grow`).toContain('read:grow');
      }
    }
  });
});

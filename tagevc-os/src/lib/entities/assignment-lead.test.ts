import { describe, expect, it } from 'vitest';
import {
  filterEntitiesAssignedToLead,
  isAssignedToLeadEntity,
  isLeadScopedAssetRole,
  resolveSubsidiaryLeaderEntityId,
} from './assignment-lead';

describe('assignment-to-lead (Assets Businesses / RE)', () => {
  it('marks coo + sub_lead as lead-scoped', () => {
    expect(isLeadScopedAssetRole('coo')).toBe(true);
    expect(isLeadScopedAssetRole('sub_lead')).toBe(true);
    expect(isLeadScopedAssetRole('visionary')).toBe(false);
    expect(isLeadScopedAssetRole('partner')).toBe(false);
  });

  it('COO sees only assigned (coo_owner) entities — not unassigned or PM-owned', () => {
    expect(
      isAssignedToLeadEntity({
        role: 'coo',
        profileEntityId: 'ENT-FIRM',
        profileFullName: 'Josh Monroe',
        entity: {
          entity_id: 'ENT-R619',
          coo_owner: 'COO — Ops Lead',
          parent_entity_id: 'ENT-FIRM',
        },
      }),
    ).toBe(true);

    expect(
      isAssignedToLeadEntity({
        role: 'coo',
        profileEntityId: 'ENT-FIRM',
        entity: {
          entity_id: 'ENT-ORPHAN',
          coo_owner: null,
          parent_entity_id: 'ENT-FIRM',
        },
      }),
    ).toBe(false);

    expect(
      isAssignedToLeadEntity({
        role: 'coo',
        profileEntityId: 'ENT-FIRM',
        entity: {
          entity_id: 'ENT-RE-001',
          coo_owner: 'PM — Resi',
          parent_entity_id: 'ENT-FIRM',
        },
      }),
    ).toBe(false);
  });

  it('sub_lead is scoped to profile entity_id (single company)', () => {
    expect(resolveSubsidiaryLeaderEntityId('ENT-FIRM')).toBe('ENT-R619');
    expect(resolveSubsidiaryLeaderEntityId('ENT-INDA')).toBe('ENT-INDA');

    expect(
      isAssignedToLeadEntity({
        role: 'sub_lead',
        profileEntityId: 'ENT-R619',
        entity: {
          entity_id: 'ENT-R619',
          coo_owner: 'COO — Ops Lead',
          parent_entity_id: 'ENT-FIRM',
        },
      }),
    ).toBe(true);
    expect(
      isAssignedToLeadEntity({
        role: 'sub_lead',
        profileEntityId: 'ENT-R619',
        entity: {
          entity_id: 'ENT-INDA',
          coo_owner: 'COO — Ops Lead',
          parent_entity_id: 'ENT-FIRM',
        },
      }),
    ).toBe(false);
    // Impersonation from firm profile must not expose every subsidiary.
    expect(
      isAssignedToLeadEntity({
        role: 'sub_lead',
        profileEntityId: 'ENT-FIRM',
        entity: {
          entity_id: 'ENT-R619',
          coo_owner: 'COO — Ops Lead',
          parent_entity_id: 'ENT-FIRM',
        },
      }),
    ).toBe(true);
    expect(
      isAssignedToLeadEntity({
        role: 'sub_lead',
        profileEntityId: 'ENT-FIRM',
        entity: {
          entity_id: 'ENT-INDA',
          coo_owner: 'COO — Ops Lead',
          parent_entity_id: 'ENT-FIRM',
        },
      }),
    ).toBe(false);
  });

  it('filterEntitiesAssignedToLead is a no-op for firm-wide roles', () => {
    const rows = [
      {
        entity_id: 'ENT-R619',
        coo_owner: 'COO — Ops Lead' as string | null,
        parent_entity_id: 'ENT-FIRM' as string | null,
      },
      {
        entity_id: 'ENT-X',
        coo_owner: null as string | null,
        parent_entity_id: 'ENT-FIRM' as string | null,
      },
    ];
    expect(
      filterEntitiesAssignedToLead(rows, {
        role: 'visionary',
        profileEntityId: 'ENT-FIRM',
      }),
    ).toHaveLength(2);
    expect(
      filterEntitiesAssignedToLead(rows, {
        role: 'coo',
        profileEntityId: 'ENT-FIRM',
      }),
    ).toEqual([rows[0]]);
  });
});

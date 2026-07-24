/**
 * Phase 62 — HR operating depth (roster, JML packs, policies, templates).
 * Extends Phase 57 + P5; modular for future Signent/fractional HR reuse.
 */

import { entityDisplayName } from '@/lib/entities/display-name';
import {
  defaultLifecycleChecklist,
  type LifecycleKind,
} from '@/lib/multi-sub/lifecycle';
import type { SsRequestTemplate } from '@/lib/shared-services/finance-ops-phase62';
import { APP_ROLE_LABELS, type AppRole } from '@/lib/types/roles';

export const PHASE62_HR_OPS_CONTRACT_VERSION = 'phase62-v1' as const;

export const HR_REQUEST_TEMPLATES: SsRequestTemplate[] = [
  {
    template_id: 'hr_new_hire',
    service: 'HR',
    title: 'New hire onboarding',
    description:
      'Start joiner checklist: profile, access, IT hardware/license, and company assignment.',
    default_priority: 'P1',
  },
  {
    template_id: 'hr_role_change',
    service: 'HR',
    title: 'Role or company change',
    description:
      'Mover flow: update company/role and re-scope messaging and ticketing access.',
    default_priority: 'P2',
  },
  {
    template_id: 'hr_offboard',
    service: 'HR',
    title: 'Offboarding / access revoke',
    description:
      'Leaver flow: revoke access first, then IT return and evidence pack.',
    default_priority: 'P0',
  },
];

export type HrPolicySkeletonItem = {
  id: string;
  title: string;
  status: 'planned' | 'draft' | 'active';
  summary: string;
};

export const HR_POLICY_SKELETON: HrPolicySkeletonItem[] = [
  {
    id: 'code_of_conduct',
    title: 'Code of conduct',
    status: 'planned',
    summary: 'Expected workplace conduct across Tage and portfolio companies.',
  },
  {
    id: 'access_acceptable_use',
    title: 'Acceptable use & access',
    status: 'draft',
    summary: 'Portal, email, and device use expectations tied to joiners/leavers.',
  },
  {
    id: 'data_handling',
    title: 'People data handling',
    status: 'planned',
    summary: 'How employee records and offboarding evidence are retained.',
  },
];

/** Modular checklist packs — firm vs future outsourced/Signent delivery. */
export type HrChecklistPack = {
  pack_id: string;
  label: string;
  audience: 'firm' | 'subsidiary' | 'outsourced_hr';
  lifecycle: LifecycleKind;
  steps: Array<{ id: string; label: string }>;
};

export function hrChecklistPacks(entityId?: string | null): HrChecklistPack[] {
  const joiner = defaultLifecycleChecklist('joiner', entityId);
  const mover = defaultLifecycleChecklist('mover', entityId);
  const leaver = defaultLifecycleChecklist('leaver', entityId);
  return [
    {
      pack_id: 'firm_joiner',
      label: 'Firm joiner pack',
      audience: 'firm',
      lifecycle: 'joiner',
      steps: joiner.map((s) => ({ id: s.id, label: s.label })),
    },
    {
      pack_id: 'firm_mover',
      label: 'Firm mover pack',
      audience: 'firm',
      lifecycle: 'mover',
      steps: mover.map((s) => ({ id: s.id, label: s.label })),
    },
    {
      pack_id: 'firm_leaver',
      label: 'Firm leaver pack (revoke first)',
      audience: 'firm',
      lifecycle: 'leaver',
      steps: leaver.map((s) => ({ id: s.id, label: s.label })),
    },
    {
      pack_id: 'outsourced_hr_joiner',
      label: 'Outsourced / fractional HR joiner (future)',
      audience: 'outsourced_hr',
      lifecycle: 'joiner',
      steps: [
        { id: 'collect_hire_packet', label: 'Collect hire packet' },
        { id: 'policy_ack', label: 'Policy acknowledgements' },
        { id: 'handoff_it', label: 'Hand off IT provisioning' },
        { id: 'day_one_checkin', label: 'Day-one check-in' },
      ],
    },
  ];
}

export type HrRosterPerson = {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole | string;
  role_label: string;
  entity_id: string | null;
  company_name: string;
  active: boolean;
  updated_at: string | null;
};

export function mapProfileToRosterPerson(row: {
  id: string;
  email: string;
  full_name?: string | null;
  role?: string | null;
  entity_id?: string | null;
  active?: boolean | null;
  updated_at?: string | null;
}): HrRosterPerson {
  const role = (row.role ?? 'associate') as AppRole;
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name ?? null,
    role,
    role_label: APP_ROLE_LABELS[role as AppRole] ?? String(row.role ?? '—'),
    entity_id: row.entity_id ?? null,
    company_name: entityDisplayName(row.entity_id ?? 'ENT-FIRM'),
    active: Boolean(row.active ?? true),
    updated_at: row.updated_at ?? null,
  };
}

export function hrTicketHref(templateId: string, entityId?: string | null): string {
  const params = new URLSearchParams({
    service: 'HR',
    template: templateId,
  });
  if (entityId) params.set('entity', entityId);
  return `/shared-services?${params.toString()}#create-ticket`;
}

export function lifecycleKindLabel(kind: LifecycleKind): string {
  switch (kind) {
    case 'joiner':
      return 'Joiner';
    case 'mover':
      return 'Mover';
    case 'leaver':
      return 'Leaver';
  }
}

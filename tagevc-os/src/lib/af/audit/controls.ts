/**
 * Audit trail + SOC2 controls catalog (build order steps 10 + 12).
 */

import { createPersistClient } from '@/lib/supabase/persist-client';

export type AfAuditEntry = {
  id?: string;
  occurredAt: string;
  actorLabel?: string | null;
  entityCode?: string | null;
  action: string;
  refType?: string | null;
  refId?: string | null;
  detail?: Record<string, unknown>;
};

export type AfControl = {
  controlId: string;
  domain: string;
  title: string;
  description: string;
  sodRelevant: boolean;
  status: string;
  evidenceHref?: string | null;
};

const memoryAudit: AfAuditEntry[] = [];

export const FALLBACK_CONTROLS: AfControl[] = [
  {
    controlId: 'CTL-AF-01',
    domain: 'Access',
    title: 'RBAC matrix enforced',
    description: 'Roles × capabilities from Spec - RBAC Matrix',
    sodRelevant: true,
    status: 'Implemented',
  },
  {
    controlId: 'CTL-AF-02',
    domain: 'SoD',
    title: 'Prepare ≠ Approve+Pay',
    description: 'Same user cannot prepare and approve+pay a payment batch',
    sodRelevant: true,
    status: 'Implemented',
  },
  {
    controlId: 'CTL-AF-03',
    domain: 'Change',
    title: 'Immutable audit log',
    description: 'os_af_audit_log append-only with triggers',
    sodRelevant: false,
    status: 'Implemented',
  },
  {
    controlId: 'CTL-AF-04',
    domain: 'Availability',
    title: 'Go-live gates production',
    description: 'Send/pay blocked until ORG+ENT required steps Done',
    sodRelevant: false,
    status: 'Implemented',
  },
  {
    controlId: 'CTL-AF-05',
    domain: 'Confidentiality',
    title: 'Attachment bucket private',
    description: 'af-attachments storage not public',
    sodRelevant: false,
    status: 'Implemented',
  },
  {
    controlId: 'CTL-AF-06',
    domain: 'Processing',
    title: 'Idempotent webhooks',
    description: 'event_id primary key on os_af_events',
    sodRelevant: false,
    status: 'Implemented',
  },
  {
    controlId: 'CTL-AF-07',
    domain: 'IC',
    title: 'IC eliminations on consol',
    description: 'Due From 141x ↔ Due To 2450 eliminated in NW',
    sodRelevant: false,
    status: 'Implemented',
  },
  {
    controlId: 'CTL-AF-08',
    domain: 'Banking',
    title: 'Feed connect evidence',
    description: 'ENT-03 bank feed OAuth + test import recorded',
    sodRelevant: false,
    status: 'In progress',
  },
  {
    controlId: 'CTL-AF-09',
    domain: 'Close',
    title: 'Period soft/hard lock',
    description: 'Hard lock blocks posting; reopen audited',
    sodRelevant: true,
    status: 'Implemented',
  },
  {
    controlId: 'CTL-AF-10',
    domain: 'Close',
    title: 'Period snapshots',
    description: 'Continuous close snapshots before hard lock',
    sodRelevant: false,
    status: 'Implemented',
  },
  {
    controlId: 'CTL-AF-11',
    domain: 'AP',
    title: '1099 W-9 gate',
    description: 'Block pay when 1099 vendor missing W-9',
    sodRelevant: false,
    status: 'Implemented',
  },
  {
    controlId: 'CTL-AF-12',
    domain: 'AR',
    title: 'Collections cadence',
    description: 'Reminder offsets −3 / due / +7 / +14 / +30',
    sodRelevant: false,
    status: 'Implemented',
  },
  {
    controlId: 'CTL-AF-13',
    domain: 'Processing',
    title: 'OpenAPI event contracts',
    description: 'Spec - API Webhooks published at /api/af/openapi',
    sodRelevant: false,
    status: 'Implemented',
  },
];

/** Spec - RBAC Matrix capabilities for Controls UI. */
export const AF_RBAC_MATRIX: {
  capability: string;
  entityUser: string;
  entityMgr: string;
  accountant: string;
  controller: string;
  finance: string;
  admin: string;
  auditor: string;
}[] = [
  {
    capability: 'View own entity ops',
    entityUser: 'Y',
    entityMgr: 'Y',
    accountant: 'Y',
    controller: 'Y',
    finance: 'Y',
    admin: 'Y',
    auditor: 'Y',
  },
  {
    capability: 'Create invoice draft',
    entityUser: 'Y',
    entityMgr: 'Y',
    accountant: 'Y',
    controller: 'Y',
    finance: 'N',
    admin: 'Y',
    auditor: 'N',
  },
  {
    capability: 'Approve / send invoice',
    entityUser: 'N',
    entityMgr: 'Y',
    accountant: 'Y',
    controller: 'Y',
    finance: 'N',
    admin: 'Y',
    auditor: 'N',
  },
  {
    capability: 'Post AP / pay bills',
    entityUser: 'N',
    entityMgr: 'N',
    accountant: 'Prepare',
    controller: 'Approve+Pay*',
    finance: 'N',
    admin: 'Y',
    auditor: 'N',
  },
  {
    capability: 'Period lock / reopen',
    entityUser: 'N',
    entityMgr: 'N',
    accountant: 'N',
    controller: 'Y',
    finance: 'N',
    admin: 'Y',
    auditor: 'N',
  },
  {
    capability: 'Budgets / forecasts',
    entityUser: 'View',
    entityMgr: 'Edit entity',
    accountant: 'View',
    controller: 'Y',
    finance: 'Y',
    admin: 'Y',
    auditor: 'View',
  },
  {
    capability: 'Audit workspace',
    entityUser: 'N',
    entityMgr: 'N',
    accountant: 'N',
    controller: 'Y',
    finance: 'Y',
    admin: 'Y',
    auditor: 'Y read-only',
  },
  {
    capability: 'Personal Finance (Visionary)',
    entityUser: 'N',
    entityMgr: 'N',
    accountant: 'N',
    controller: 'N',
    finance: 'N',
    admin: 'Y*',
    auditor: 'N',
  },
];

export async function writeAfAudit(entry: AfAuditEntry): Promise<void> {
  const row: AfAuditEntry = {
    ...entry,
    occurredAt: entry.occurredAt || new Date().toISOString(),
  };
  memoryAudit.unshift(row);
  if (memoryAudit.length > 300) memoryAudit.pop();

  try {
    const supabase = await createPersistClient();
    if (!supabase) return;
    await supabase.from('os_af_audit_log').insert({
      occurred_at: row.occurredAt,
      actor_label: row.actorLabel ?? null,
      entity_code: row.entityCode ?? null,
      action: row.action,
      ref_type: row.refType ?? null,
      ref_id: row.refId ?? null,
      detail: row.detail ?? {},
    });
  } catch (e) {
    console.error('writeAfAudit', e);
  }
}

export async function listAfAudit(limit = 50): Promise<AfAuditEntry[]> {
  try {
    const supabase = await createPersistClient();
    if (!supabase) return memoryAudit.slice(0, limit);
    const { data, error } = await supabase
      .from('os_af_audit_log')
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(limit);
    if (error || !data?.length) return memoryAudit.slice(0, limit);
    return data.map((r) => ({
      id: String(r.id),
      occurredAt: String(r.occurred_at),
      actorLabel: (r.actor_label as string) ?? null,
      entityCode: (r.entity_code as string) ?? null,
      action: String(r.action),
      refType: (r.ref_type as string) ?? null,
      refId: (r.ref_id as string) ?? null,
      detail: (r.detail ?? {}) as Record<string, unknown>,
    }));
  } catch {
    return memoryAudit.slice(0, limit);
  }
}

export async function listAfControls(): Promise<AfControl[]> {
  try {
    const supabase = await createPersistClient();
    if (!supabase) return FALLBACK_CONTROLS;
    const { data, error } = await supabase
      .from('os_af_controls')
      .select('*')
      .order('control_id');
    if (error || !data?.length) return FALLBACK_CONTROLS;
    return data.map((r) => ({
      controlId: String(r.control_id),
      domain: String(r.domain),
      title: String(r.title),
      description: String(r.description ?? ''),
      sodRelevant: Boolean(r.sod_relevant),
      status: String(r.status),
      evidenceHref: (r.evidence_href as string) ?? null,
    }));
  } catch {
    return FALLBACK_CONTROLS;
  }
}

/** SoD check: prepare vs approve+pay must be different actors. */
export function assertSegregationOfDuties(input: {
  preparerId: string;
  approverId: string;
}): { ok: boolean; code?: string; message?: string } {
  if (input.preparerId && input.preparerId === input.approverId) {
    return {
      ok: false,
      code: 'SOD_VIOLATION',
      message: 'Same user cannot Prepare and Approve+Pay the same payment batch.',
    };
  }
  return { ok: true };
}

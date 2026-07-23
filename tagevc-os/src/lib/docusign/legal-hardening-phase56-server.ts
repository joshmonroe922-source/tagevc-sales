import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  PHASE56_LEGAL_CONTRACT_VERSION,
  emptyLegalHardeningPhase56Report,
  type ArchiveIntegrityAlert,
  type CapitalSendProposal,
  type LegalGovernanceStatus,
  type LegalHardeningPhase56Report,
  type LegalQuarterlyStep,
  type SubsidiaryLegalVisibility,
} from '@/lib/docusign/legal-hardening-phase56';

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (
    typeof value === 'string' &&
    value.trim() !== '' &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  return null;
}

function asCount(value: unknown): number {
  const n = asNumber(value);
  return n != null && n >= 0 ? n : 0;
}

function asGovernanceStatus(value: unknown): LegalGovernanceStatus {
  const raw = String(value ?? 'missing');
  if (
    raw === 'ok' ||
    raw === 'partial' ||
    raw === 'missing' ||
    raw === 'unknown'
  ) {
    return raw;
  }
  return 'unknown';
}

function asQuarterly(value: unknown): LegalQuarterlyStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      event_id: typeof row.event_id === 'string' ? row.event_id : undefined,
      entity_id: typeof row.entity_id === 'string' ? row.entity_id : null,
      period_key: String(row.period_key ?? ''),
      step_key: String(row.step_key ?? ''),
      step_label: String(row.step_label ?? ''),
      status: String(row.status ?? 'open'),
      created_at: String(row.created_at ?? ''),
    }))
    .filter((row) => row.step_key.length > 0);
}

function asArchiveAlerts(value: unknown): ArchiveIntegrityAlert[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      alert_id: typeof row.alert_id === 'string' ? row.alert_id : undefined,
      entity_id: typeof row.entity_id === 'string' ? row.entity_id : null,
      alert_kind: String(row.alert_kind ?? 'integrity_unknown'),
      severity: String(row.severity ?? 'warning'),
      title: String(row.title ?? 'Archive alert'),
      created_at: String(row.created_at ?? ''),
    }));
}

function asProposals(value: unknown): CapitalSendProposal[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      proposal_id: String(row.proposal_id ?? ''),
      entity_id: typeof row.entity_id === 'string' ? row.entity_id : null,
      template_id: typeof row.template_id === 'string' ? row.template_id : null,
      doc_id: typeof row.doc_id === 'string' ? row.doc_id : null,
      summary: String(row.summary ?? ''),
      proposed_by: String(row.proposed_by ?? ''),
      status: String(row.status ?? 'pending'),
      created_at: String(row.created_at ?? ''),
    }))
    .filter((row) => row.proposal_id.length > 0);
}

function asSubsidiaries(value: unknown): SubsidiaryLegalVisibility[] {
  const empty = emptyLegalHardeningPhase56Report();
  if (!Array.isArray(value) || value.length === 0) return empty.subsidiaries;
  const out: SubsidiaryLegalVisibility[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const entity_id = String(r.entity_id ?? '');
    if (!entity_id.startsWith('ENT-')) continue;
    out.push({
      entity_id,
      name: String(r.name ?? entity_id),
      priority: asCount(r.priority) || out.length + 1,
      visibility_status: asGovernanceStatus(r.visibility_status),
      open_count: asCount(r.open_count),
      overdue_count: asCount(r.overdue_count),
      has_data: r.has_data === true,
      todo: typeof r.todo === 'string' ? r.todo : null,
    });
  }
  return out.length ? out : empty.subsidiaries;
}

function normalizeReport(
  data: Record<string, unknown> | null | undefined,
  entityId: string | null,
): LegalHardeningPhase56Report {
  const empty = emptyLegalHardeningPhase56Report(entityId);
  if (!data) return empty;
  return {
    ...empty,
    entity_id:
      typeof data.entity_id === 'string'
        ? data.entity_id
        : data.entity_id === null
          ? null
          : entityId,
    templates_cached: asCount(data.templates_cached),
    templates_with_roles: asCount(data.templates_with_roles),
    templates_stale: asCount(data.templates_stale),
    completeness_pct: asNumber(data.completeness_pct),
    governance_status: asGovernanceStatus(data.governance_status),
    pending_capital_send_count: asCount(data.pending_capital_send_count),
    quarantine_count: asCount(data.quarantine_count),
    period_key: String(data.period_key ?? empty.period_key),
    snapshot_id:
      typeof data.snapshot_id === 'string' ? data.snapshot_id : null,
    captured_at:
      typeof data.captured_at === 'string' ? data.captured_at : null,
    quarterly_steps: asQuarterly(data.quarterly_steps),
    archive_alerts: asArchiveAlerts(data.archive_alerts),
    capital_send_proposals: asProposals(data.capital_send_proposals),
    recent_alerts: Array.isArray(data.recent_alerts)
      ? (data.recent_alerts as Array<Record<string, unknown>>)
      : [],
    subsidiaries: asSubsidiaries(data.subsidiaries),
    entity_filter_hint: String(
      data.entity_filter_hint ?? empty.entity_filter_hint,
    ),
    todo: String(data.todo ?? empty.todo),
    envelope_send_executed: false,
    never_silent_send: true,
    never_creates_voids_or_resends: true,
    contract_version: PHASE56_LEGAL_CONTRACT_VERSION,
  };
}

/** Fail-soft report fetch — empty stubs when RPC unavailable. */
export async function getLegalHardeningPhase56Report(input?: {
  entityId?: string | null;
}): Promise<LegalHardeningPhase56Report> {
  const entityId = input?.entityId ?? null;
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc(
      'get_legal_docusign_hardening_phase56_report',
      { p_entity_id: entityId },
    );
    if (error) {
      console.error(
        'legal docusign hardening phase56 report unavailable',
        error.message,
      );
      return emptyLegalHardeningPhase56Report(entityId);
    }
    return normalizeReport(
      (data as Record<string, unknown> | null) ?? null,
      entityId,
    );
  } catch (caught) {
    console.error(
      'legal docusign hardening phase56 report failed',
      caught instanceof Error ? caught.message : caught,
    );
    return emptyLegalHardeningPhase56Report(entityId);
  }
}

export async function refreshLegalHardeningPhase56(input?: {
  actorId?: string | null;
  entityId?: string | null;
}) {
  const entityId = input?.entityId ?? null;
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc(
      'refresh_legal_docusign_hardening_phase56',
      {
        p_actor_id: input?.actorId ?? null,
        p_entity_id: entityId,
      },
    );
    if (error) {
      return {
        ok: false as const,
        error: error.message,
        report: await getLegalHardeningPhase56Report({ entityId }),
      };
    }
    return {
      ok: true as const,
      summary: (data as Record<string, unknown>) ?? {},
      report: await getLegalHardeningPhase56Report({ entityId }),
      envelope_send_executed: false as const,
      never_creates_voids_or_resends: true as const,
    };
  } catch (caught) {
    return {
      ok: false as const,
      error:
        caught instanceof Error
          ? caught.message
          : 'Phase 56 legal refresh failed',
      report: await getLegalHardeningPhase56Report({ entityId }),
    };
  }
}

export async function proposeCapitalSendPhase56(input: {
  entityId?: string | null;
  templateId?: string | null;
  docId?: string | null;
  summary: string;
  proposedBy: string;
}) {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc('propose_capital_send_phase56', {
      p_payload: {
        entity_id: input.entityId ?? null,
        template_id: input.templateId ?? null,
        doc_id: input.docId ?? null,
        summary: input.summary,
        proposed_by: input.proposedBy,
        detail: {
          contract_version: PHASE56_LEGAL_CONTRACT_VERSION,
          envelope_send_executed: false,
          never_silent_send: true,
          dual_approve_required: true,
        },
      },
    });
    if (error) return { ok: false as const, error: error.message };
    return {
      ok: true as const,
      data: (data as Record<string, unknown>) ?? {},
      envelope_send_executed: false as const,
    };
  } catch (caught) {
    return {
      ok: false as const,
      error:
        caught instanceof Error
          ? caught.message
          : 'Phase 56 capital send proposal failed',
    };
  }
}

export async function approveCapitalSendPhase56(input: {
  proposalId: string;
  actorId: string;
  decision: 'approve' | 'reject';
}) {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc('approve_capital_send_phase56', {
      p_proposal_id: input.proposalId,
      p_actor_id: input.actorId,
      p_decision: input.decision,
      p_detail: {
        contract_version: PHASE56_LEGAL_CONTRACT_VERSION,
        envelope_send_executed: false,
      },
    });
    if (error) return { ok: false as const, error: error.message };
    return {
      ok: true as const,
      data: (data as Record<string, unknown>) ?? {},
      envelope_send_executed: false as const,
    };
  } catch (caught) {
    return {
      ok: false as const,
      error:
        caught instanceof Error
          ? caught.message
          : 'Phase 56 capital send approval failed',
    };
  }
}

export async function recordQuarterlyProcessPhase56(input: {
  entityId?: string | null;
  periodKey: string;
  stepKey: string;
  stepLabel: string;
  status: string;
  actorId?: string | null;
}) {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc('record_quarterly_process_phase56', {
      p_payload: {
        entity_id: input.entityId ?? null,
        period_key: input.periodKey,
        step_key: input.stepKey,
        step_label: input.stepLabel,
        status: input.status,
        actor_id: input.actorId ?? null,
        detail: {
          contract_version: PHASE56_LEGAL_CONTRACT_VERSION,
          never_creates_voids_or_resends: true,
        },
      },
    });
    if (error) return { ok: false as const, error: error.message };
    return {
      ok: true as const,
      data: (data as Record<string, unknown>) ?? {},
      never_creates_voids_or_resends: true as const,
    };
  } catch (caught) {
    return {
      ok: false as const,
      error:
        caught instanceof Error
          ? caught.message
          : 'Phase 56 quarterly process record failed',
    };
  }
}

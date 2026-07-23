import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  PHASE57_HR_IT_CONTRACT_VERSION,
  emptyHrItHardeningPhase57Report,
  type AgingAlert,
  type DualApproveInboxItem,
  type EscalationEvent,
  type HighRiskProposal,
  type HrItBoardStatus,
  type HrItHardeningPhase57Report,
  type RevocationEvidence,
  type SubsidiaryHrItVisibility,
} from '@/lib/shared-services/hr-it-hardening-phase57';

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

function asBoardStatus(value: unknown): HrItBoardStatus {
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

function asAging(value: unknown): AgingAlert[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      alert_id: typeof row.alert_id === 'string' ? row.alert_id : undefined,
      entity_id: typeof row.entity_id === 'string' ? row.entity_id : null,
      alert_kind: String(row.alert_kind ?? 'manual_flag'),
      severity: String(row.severity ?? 'warning'),
      title: String(row.title ?? 'Aging alert'),
      age_hours: asCount(row.age_hours),
      created_at: String(row.created_at ?? ''),
    }));
}

function asEscalations(value: unknown): EscalationEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      event_id: typeof row.event_id === 'string' ? row.event_id : undefined,
      entity_id: typeof row.entity_id === 'string' ? row.entity_id : null,
      escalation_kind: String(row.escalation_kind ?? 'manual'),
      reference_id:
        typeof row.reference_id === 'string' ? row.reference_id : null,
      title: String(row.title ?? 'Escalation'),
      status: String(row.status ?? 'open'),
      created_at: String(row.created_at ?? ''),
    }));
}

function asProposals(value: unknown): HighRiskProposal[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      proposal_id: String(row.proposal_id ?? ''),
      entity_id: typeof row.entity_id === 'string' ? row.entity_id : null,
      action_kind: String(row.action_kind ?? 'other_high_risk'),
      summary: String(row.summary ?? ''),
      proposed_by: String(row.proposed_by ?? ''),
      status: String(row.status ?? 'pending'),
      created_at: String(row.created_at ?? ''),
    }))
    .filter((row) => row.proposal_id.length > 0);
}

function asRevocations(value: unknown): RevocationEvidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      evidence_id:
        typeof row.evidence_id === 'string' ? row.evidence_id : undefined,
      entity_id: typeof row.entity_id === 'string' ? row.entity_id : null,
      run_id: typeof row.run_id === 'string' ? row.run_id : null,
      user_ref: typeof row.user_ref === 'string' ? row.user_ref : null,
      revocation_kind: String(row.revocation_kind ?? 'other_observe'),
      evidence_status: String(row.evidence_status ?? 'observed'),
      created_at: String(row.created_at ?? ''),
    }));
}

function asInboxItems(value: unknown): DualApproveInboxItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      kind: typeof row.kind === 'string' ? row.kind : undefined,
      reference_id:
        typeof row.reference_id === 'string' ? row.reference_id : undefined,
      awaiting_since:
        typeof row.awaiting_since === 'string' ? row.awaiting_since : undefined,
      ...row,
    }));
}

function asSubsidiaries(value: unknown): SubsidiaryHrItVisibility[] {
  const empty = emptyHrItHardeningPhase57Report();
  if (!Array.isArray(value) || value.length === 0) return empty.subsidiaries;
  const out: SubsidiaryHrItVisibility[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const entity_id = String(r.entity_id ?? '');
    if (!entity_id.startsWith('ENT-')) continue;
    out.push({
      entity_id,
      name: String(r.name ?? entity_id),
      priority: asCount(r.priority) || out.length + 1,
      visibility_status: asBoardStatus(r.visibility_status),
      open_runs: asCount(r.open_runs),
      aging_alerts: asCount(r.aging_alerts),
      has_data: r.has_data === true,
      todo: typeof r.todo === 'string' ? r.todo : null,
    });
  }
  return out.length ? out : empty.subsidiaries;
}

function normalizeReport(
  data: Record<string, unknown> | null | undefined,
  entityId: string | null,
): HrItHardeningPhase57Report {
  const empty = emptyHrItHardeningPhase57Report(entityId);
  if (!data) return empty;
  return {
    ...empty,
    entity_id:
      typeof data.entity_id === 'string'
        ? data.entity_id
        : data.entity_id === null
          ? null
          : entityId,
    onboarding_open: asCount(data.onboarding_open),
    onboarding_completed: asCount(data.onboarding_completed),
    offboarding_open: asCount(data.offboarding_open),
    offboarding_completed: asCount(data.offboarding_completed),
    identity_lifecycle_open: asCount(data.identity_lifecycle_open),
    completeness_pct: asNumber(data.completeness_pct),
    board_status: asBoardStatus(data.board_status),
    assignment_visibility_status: asBoardStatus(
      data.assignment_visibility_status,
    ),
    hardware_assigned: asCount(data.hardware_assigned),
    hardware_in_stock: asCount(data.hardware_in_stock),
    license_seats_used: asCount(data.license_seats_used),
    license_seats_total: asCount(data.license_seats_total),
    pending_high_risk_count: asCount(data.pending_high_risk_count),
    inbox_pending_count: asCount(data.inbox_pending_count),
    inbox_stale_count: asCount(data.inbox_stale_count),
    inbox_critical_count: asCount(data.inbox_critical_count),
    snapshot_id:
      typeof data.snapshot_id === 'string' ? data.snapshot_id : null,
    captured_at:
      typeof data.captured_at === 'string' ? data.captured_at : null,
    aging_alerts: asAging(data.aging_alerts),
    escalations: asEscalations(data.escalations),
    high_risk_proposals: asProposals(data.high_risk_proposals),
    revocation_evidence: asRevocations(data.revocation_evidence),
    inbox_items: asInboxItems(data.inbox_items),
    recent_alerts: Array.isArray(data.recent_alerts)
      ? (data.recent_alerts as Array<Record<string, unknown>>)
      : [],
    subsidiaries: asSubsidiaries(data.subsidiaries),
    entity_filter_hint: String(
      data.entity_filter_hint ?? empty.entity_filter_hint,
    ),
    todo: String(data.todo ?? empty.todo),
    breaker_auto_closed: false,
    access_revoke_executed: false,
    dual_approve_required: true,
    never_auto_close_breakers: true,
    contract_version: PHASE57_HR_IT_CONTRACT_VERSION,
  };
}

/** Fail-soft report fetch — empty stubs when RPC unavailable. */
export async function getHrItHardeningPhase57Report(input?: {
  entityId?: string | null;
}): Promise<HrItHardeningPhase57Report> {
  const entityId = input?.entityId ?? null;
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc(
      'get_hr_it_hardening_phase57_report',
      { p_entity_id: entityId },
    );
    if (error) {
      console.error(
        'hr/it hardening phase57 report unavailable',
        error.message,
      );
      return emptyHrItHardeningPhase57Report(entityId);
    }
    return normalizeReport(
      (data as Record<string, unknown> | null) ?? null,
      entityId,
    );
  } catch (caught) {
    console.error(
      'hr/it hardening phase57 report failed',
      caught instanceof Error ? caught.message : caught,
    );
    return emptyHrItHardeningPhase57Report(entityId);
  }
}

export async function refreshHrItHardeningPhase57(input?: {
  actorId?: string | null;
  entityId?: string | null;
}) {
  const entityId = input?.entityId ?? null;
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc('refresh_hr_it_hardening_phase57', {
      p_actor_id: input?.actorId ?? null,
      p_entity_id: entityId,
    });
    if (error) {
      return {
        ok: false as const,
        error: error.message,
        report: await getHrItHardeningPhase57Report({ entityId }),
      };
    }
    return {
      ok: true as const,
      summary: (data as Record<string, unknown>) ?? {},
      report: await getHrItHardeningPhase57Report({ entityId }),
      breaker_auto_closed: false as const,
      access_revoke_executed: false as const,
      never_auto_close_breakers: true as const,
    };
  } catch (caught) {
    return {
      ok: false as const,
      error:
        caught instanceof Error
          ? caught.message
          : 'Phase 57 HR/IT refresh failed',
      report: await getHrItHardeningPhase57Report({ entityId }),
    };
  }
}

export async function proposeHrItHighRiskPhase57(input: {
  entityId?: string | null;
  actionKind: string;
  summary: string;
  proposedBy: string;
}) {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc('propose_hr_it_high_risk_phase57', {
      p_payload: {
        entity_id: input.entityId ?? null,
        action_kind: input.actionKind,
        summary: input.summary,
        proposed_by: input.proposedBy,
        detail: {
          contract_version: PHASE57_HR_IT_CONTRACT_VERSION,
          breaker_auto_closed: false,
          access_revoke_executed: false,
          dual_approve_required: true,
        },
      },
    });
    if (error) return { ok: false as const, error: error.message };
    return {
      ok: true as const,
      data: (data as Record<string, unknown>) ?? {},
      breaker_auto_closed: false as const,
      access_revoke_executed: false as const,
    };
  } catch (caught) {
    return {
      ok: false as const,
      error:
        caught instanceof Error
          ? caught.message
          : 'Phase 57 high-risk proposal failed',
    };
  }
}

export async function approveHrItHighRiskPhase57(input: {
  proposalId: string;
  actorId: string;
  decision: 'approve' | 'reject';
}) {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc('approve_hr_it_high_risk_phase57', {
      p_proposal_id: input.proposalId,
      p_actor_id: input.actorId,
      p_decision: input.decision,
      p_detail: {
        contract_version: PHASE57_HR_IT_CONTRACT_VERSION,
        breaker_auto_closed: false,
        access_revoke_executed: false,
      },
    });
    if (error) return { ok: false as const, error: error.message };
    return {
      ok: true as const,
      data: (data as Record<string, unknown>) ?? {},
      breaker_auto_closed: false as const,
      access_revoke_executed: false as const,
    };
  } catch (caught) {
    return {
      ok: false as const,
      error:
        caught instanceof Error
          ? caught.message
          : 'Phase 57 high-risk approval failed',
    };
  }
}

export async function recordHrItEscalationPhase57(input: {
  entityId?: string | null;
  escalationKind: string;
  title: string;
  status: string;
  referenceId?: string | null;
  actorId?: string | null;
}) {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc('record_hr_it_escalation_phase57', {
      p_payload: {
        entity_id: input.entityId ?? null,
        escalation_kind: input.escalationKind,
        title: input.title,
        status: input.status,
        reference_id: input.referenceId ?? null,
        actor_id: input.actorId ?? null,
        detail: {
          contract_version: PHASE57_HR_IT_CONTRACT_VERSION,
          breaker_auto_closed: false,
        },
      },
    });
    if (error) return { ok: false as const, error: error.message };
    return {
      ok: true as const,
      data: (data as Record<string, unknown>) ?? {},
      breaker_auto_closed: false as const,
    };
  } catch (caught) {
    return {
      ok: false as const,
      error:
        caught instanceof Error
          ? caught.message
          : 'Phase 57 escalation record failed',
    };
  }
}

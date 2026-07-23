import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  PHASE55_FINANCE_CONTRACT_VERSION,
  emptyFinanceControlPlanePhase55Report,
  type FinanceAnomaly,
  type FinanceChecklistItem,
  type FinanceControlPlanePhase55Report,
  type FinanceFeedStatus,
  type FinanceSubsidiaryVisibility,
  type FinanceWritebackProposal,
} from '@/lib/shared-services/finance-control-plane-phase55';

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

function asFeedStatus(value: unknown): FinanceFeedStatus {
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

function asChecklist(value: unknown): FinanceChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      event_id: typeof row.event_id === 'string' ? row.event_id : undefined,
      entity_id: typeof row.entity_id === 'string' ? row.entity_id : null,
      close_kind: String(row.close_kind ?? 'month_end'),
      period_key: String(row.period_key ?? ''),
      item_key: String(row.item_key ?? ''),
      item_label: String(row.item_label ?? ''),
      status: String(row.status ?? 'open'),
      created_at: String(row.created_at ?? ''),
    }))
    .filter((row) => row.item_key.length > 0);
}

function asAnomalies(value: unknown): FinanceAnomaly[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      anomaly_id: typeof row.anomaly_id === 'string' ? row.anomaly_id : undefined,
      entity_id: typeof row.entity_id === 'string' ? row.entity_id : null,
      anomaly_kind: String(row.anomaly_kind ?? 'manual_flag'),
      severity: String(row.severity ?? 'warning'),
      title: String(row.title ?? 'Anomaly'),
      created_at: String(row.created_at ?? ''),
    }));
}

function asProposals(value: unknown): FinanceWritebackProposal[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      proposal_id: String(row.proposal_id ?? ''),
      entity_id: typeof row.entity_id === 'string' ? row.entity_id : null,
      action_kind: String(row.action_kind ?? 'ies_other_observe'),
      summary: String(row.summary ?? ''),
      proposed_by: String(row.proposed_by ?? ''),
      status: String(row.status ?? 'pending'),
      created_at: String(row.created_at ?? ''),
    }))
    .filter((row) => row.proposal_id.length > 0);
}

function asSubsidiaries(value: unknown): FinanceSubsidiaryVisibility[] {
  const empty = emptyFinanceControlPlanePhase55Report();
  if (!Array.isArray(value) || value.length === 0) return empty.subsidiaries;
  const out: FinanceSubsidiaryVisibility[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const entity_id = String(r.entity_id ?? '');
    if (!entity_id.startsWith('ENT-')) continue;
    out.push({
      entity_id,
      name: String(r.name ?? entity_id),
      priority: asCount(r.priority) || out.length + 1,
      feed_status: asFeedStatus(r.feed_status),
      has_data: r.has_data === true,
      todo: typeof r.todo === 'string' ? r.todo : null,
    });
  }
  return out.length ? out : empty.subsidiaries;
}

function normalizeReport(
  data: Record<string, unknown> | null | undefined,
  entityId: string | null,
): FinanceControlPlanePhase55Report {
  const empty = emptyFinanceControlPlanePhase55Report(entityId);
  if (!data) return empty;
  return {
    ...empty,
    entity_id:
      typeof data.entity_id === 'string'
        ? data.entity_id
        : data.entity_id === null
          ? null
          : entityId,
    cash_on_hand: asNumber(data.cash_on_hand),
    ar_balance: asNumber(data.ar_balance),
    ap_balance: asNumber(data.ap_balance),
    burn_rate_monthly: asNumber(data.burn_rate_monthly),
    close_pct_complete: asNumber(data.close_pct_complete),
    open_anomaly_count: asCount(data.open_anomaly_count),
    pending_writeback_count: asCount(data.pending_writeback_count),
    feed_status: asFeedStatus(data.feed_status),
    snapshot_id:
      typeof data.snapshot_id === 'string' ? data.snapshot_id : null,
    captured_at:
      typeof data.captured_at === 'string' ? data.captured_at : null,
    checklist: asChecklist(data.checklist),
    anomalies: asAnomalies(data.anomalies),
    writeback_proposals: asProposals(data.writeback_proposals),
    recent_alerts: Array.isArray(data.recent_alerts)
      ? (data.recent_alerts as Array<Record<string, unknown>>)
      : [],
    subsidiaries: asSubsidiaries(data.subsidiaries),
    entity_filter_hint: String(
      data.entity_filter_hint ?? empty.entity_filter_hint,
    ),
    todo: String(data.todo ?? empty.todo),
    money_auto_approve: false,
    ies_write_executed: false,
    ies_system_of_record: true,
    contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
  };
}

/** Fail-soft report fetch — empty stubs when RPC/IES feed unavailable. */
export async function getFinanceControlPlanePhase55Report(input?: {
  entityId?: string | null;
}): Promise<FinanceControlPlanePhase55Report> {
  const entityId = input?.entityId ?? null;
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc(
      'get_finance_control_plane_phase55_report',
      { p_entity_id: entityId },
    );
    if (error) {
      console.error(
        'finance control plane phase55 report unavailable',
        error.message,
      );
      return emptyFinanceControlPlanePhase55Report(entityId);
    }
    return normalizeReport(
      (data as Record<string, unknown> | null) ?? null,
      entityId,
    );
  } catch (caught) {
    console.error(
      'finance control plane phase55 report failed',
      caught instanceof Error ? caught.message : caught,
    );
    return emptyFinanceControlPlanePhase55Report(entityId);
  }
}

export async function refreshFinanceControlPlanePhase55(input?: {
  actorId?: string | null;
  entityId?: string | null;
}) {
  const entityId = input?.entityId ?? null;
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc(
      'refresh_finance_control_plane_phase55',
      {
        p_actor_id: input?.actorId ?? null,
        p_entity_id: entityId,
      },
    );
    if (error) {
      return {
        ok: false as const,
        money_auto_approve: false as const,
        ies_write_executed: false as const,
        contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
        error: error.message,
        report: emptyFinanceControlPlanePhase55Report(entityId),
      };
    }
    return {
      ok: true as const,
      money_auto_approve: false as const,
      ies_write_executed: false as const,
      contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
      summary: data as Record<string, unknown>,
      report: await getFinanceControlPlanePhase55Report({ entityId }),
    };
  } catch (caught) {
    return {
      ok: false as const,
      money_auto_approve: false as const,
      ies_write_executed: false as const,
      contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
      error:
        caught instanceof Error
          ? caught.message
          : 'Phase 55 finance control plane refresh failed',
      report: emptyFinanceControlPlanePhase55Report(entityId),
    };
  }
}

export async function recordFinanceCloseChecklistEventPhase55(input: {
  entityId?: string | null;
  closeKind: 'month_end' | 'year_end';
  periodKey: string;
  itemKey: string;
  itemLabel: string;
  status: string;
  actorId: string;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'record_finance_close_checklist_event_phase55',
    {
      p_payload: {
        entity_id: input.entityId ?? null,
        close_kind: input.closeKind,
        period_key: input.periodKey,
        item_key: input.itemKey,
        item_label: input.itemLabel,
        status: input.status,
        actor_id: input.actorId,
        detail: { contract_version: PHASE55_FINANCE_CONTRACT_VERSION },
      },
    },
  );
  if (error) return { ok: false as const, error: error.message };
  return {
    ok: true as const,
    money_auto_approve: false as const,
    ies_write_executed: false as const,
    data: (data ?? {}) as Record<string, unknown>,
  };
}

/** Propose only — never auto-approves money; never writes to IES. */
export async function proposeFinanceWritebackPhase55(input: {
  entityId?: string | null;
  actionKind: string;
  summary: string;
  proposedBy: string;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('propose_finance_writeback_phase55', {
    p_payload: {
      entity_id: input.entityId ?? null,
      action_kind: input.actionKind,
      summary: input.summary,
      proposed_by: input.proposedBy,
      detail: {
        contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
        money_auto_approve: false,
        ies_write_executed: false,
      },
    },
  });
  if (error) return { ok: false as const, error: error.message };
  return {
    ok: true as const,
    money_auto_approve: false as const,
    ies_write_executed: false as const,
    data: (data ?? {}) as Record<string, unknown>,
  };
}

/** Dual-human gate. NEVER executes IES write — operator executes in IES. */
export async function approveFinanceWritebackPhase55(input: {
  proposalId: string;
  actorId: string;
  decision: 'approve' | 'reject';
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('approve_finance_writeback_phase55', {
    p_proposal_id: input.proposalId,
    p_actor_id: input.actorId,
    p_decision: input.decision,
    p_detail: {
      contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
      money_auto_approve: false,
      ies_write_executed: false,
    },
  });
  if (error) return { ok: false as const, error: error.message };
  return {
    ok: true as const,
    money_auto_approve: false as const,
    ies_write_executed: false as const,
    data: (data ?? {}) as Record<string, unknown>,
  };
}

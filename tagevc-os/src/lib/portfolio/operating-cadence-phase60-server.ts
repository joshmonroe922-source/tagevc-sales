import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  PHASE60_PORTFOLIO_CONTRACT_VERSION,
  emptyPortfolioOperatingCadencePhase60Report,
  type PortfolioBoardStatus,
  type PortfolioOperatingCadencePhase60Report,
  type ReviewPacketEvent,
  type RiskMilestoneEvent,
  type SubsidiaryPortfolioLink,
} from '@/lib/portfolio/operating-cadence-phase60';

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

function asBoardStatus(value: unknown): PortfolioBoardStatus {
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

function asRisks(value: unknown): RiskMilestoneEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      event_id: String(row.event_id ?? ''),
      entity_id: typeof row.entity_id === 'string' ? row.entity_id : null,
      portfolio_id:
        typeof row.portfolio_id === 'string' ? row.portfolio_id : null,
      event_kind: String(row.event_kind ?? 'risk'),
      title: String(row.title ?? ''),
      status: String(row.status ?? 'open'),
      severity: String(row.severity ?? 'info'),
      due_on: typeof row.due_on === 'string' ? row.due_on : null,
      created_at: String(row.created_at ?? ''),
    }))
    .filter((row) => row.event_id.length > 0);
}

function asPackets(value: unknown): ReviewPacketEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      event_id: String(row.event_id ?? ''),
      entity_id: typeof row.entity_id === 'string' ? row.entity_id : null,
      portfolio_id:
        typeof row.portfolio_id === 'string' ? row.portfolio_id : null,
      packet_kind: String(row.packet_kind ?? 'weekly_ops'),
      title: String(row.title ?? ''),
      period_key: String(row.period_key ?? ''),
      completeness_status: String(row.completeness_status ?? 'draft'),
      created_at: String(row.created_at ?? ''),
    }))
    .filter((row) => row.event_id.length > 0);
}

function asSubsidiaries(value: unknown): SubsidiaryPortfolioLink[] {
  const empty = emptyPortfolioOperatingCadencePhase60Report().subsidiaries;
  if (!Array.isArray(value) || value.length === 0) return empty;
  const mapped = value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      entity_id: String(row.entity_id ?? ''),
      name: String(row.name ?? row.entity_id ?? ''),
      priority: asCount(row.priority) || 99,
      link_status: asBoardStatus(row.link_status),
      portfolio_id:
        typeof row.portfolio_id === 'string' ? row.portfolio_id : null,
      has_data: Boolean(row.has_data),
      todo: typeof row.todo === 'string' ? row.todo : null,
      created_at: typeof row.created_at === 'string' ? row.created_at : null,
    }))
    .filter((row) => row.entity_id.length > 0);
  if (!mapped.some((s) => s.entity_id === 'ENT-R619')) {
    return [...empty.filter((s) => s.entity_id === 'ENT-R619'), ...mapped];
  }
  return mapped;
}

function normalizeReport(
  data: Record<string, unknown> | null | undefined,
  entityId: string | null,
): PortfolioOperatingCadencePhase60Report {
  const empty = emptyPortfolioOperatingCadencePhase60Report(entityId);
  if (!data) return empty;
  return {
    ...empty,
    entity_id:
      typeof data.entity_id === 'string'
        ? data.entity_id
        : data.entity_id === null
          ? null
          : entityId,
    company_count: asCount(data.company_count),
    on_track_count: asCount(data.on_track_count),
    watch_count: asCount(data.watch_count),
    at_risk_count: asCount(data.at_risk_count),
    critical_count: asCount(data.critical_count),
    attention_required: asCount(data.attention_required),
    missing_risk_count: asCount(data.missing_risk_count),
    missing_milestone_count: asCount(data.missing_milestone_count),
    board_status: asBoardStatus(data.board_status),
    handoff_total: asCount(data.handoff_total),
    handoff_complete: asCount(data.handoff_complete),
    handoff_open: asCount(data.handoff_open),
    handoff_incomplete: asCount(data.handoff_incomplete),
    linked_to_portfolio: asCount(data.linked_to_portfolio),
    handoff_completeness_pct: asNumber(data.handoff_completeness_pct),
    handoff_board_status: asBoardStatus(data.handoff_board_status),
    snapshot_id:
      typeof data.snapshot_id === 'string' ? data.snapshot_id : null,
    captured_at:
      typeof data.captured_at === 'string' ? data.captured_at : null,
    risks_milestones: asRisks(data.risks_milestones),
    review_packets: asPackets(data.review_packets),
    subsidiaries: asSubsidiaries(data.subsidiaries),
    recent_alerts: Array.isArray(data.recent_alerts)
      ? (data.recent_alerts as Array<Record<string, unknown>>)
      : [],
    entity_filter_hint: String(
      data.entity_filter_hint ?? empty.entity_filter_hint,
    ),
    todo: String(data.todo ?? empty.todo),
    weekly_cadence: true,
    contract_version: PHASE60_PORTFOLIO_CONTRACT_VERSION,
  };
}

/** Fail-soft report fetch — empty stubs when RPC unavailable. */
export async function getPortfolioOperatingCadencePhase60Report(input?: {
  entityId?: string | null;
}): Promise<PortfolioOperatingCadencePhase60Report> {
  const entityId = input?.entityId ?? null;
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc(
      'get_portfolio_operating_cadence_phase60_report',
      { p_entity_id: entityId },
    );
    if (error) {
      console.error(
        'portfolio operating cadence phase60 report unavailable',
        error.message,
      );
      return emptyPortfolioOperatingCadencePhase60Report(entityId);
    }
    return normalizeReport(
      (data as Record<string, unknown> | null) ?? null,
      entityId,
    );
  } catch (caught) {
    console.error(
      'portfolio operating cadence phase60 report failed',
      caught instanceof Error ? caught.message : caught,
    );
    return emptyPortfolioOperatingCadencePhase60Report(entityId);
  }
}

export async function refreshPortfolioOperatingCadencePhase60(input?: {
  actorId?: string | null;
  entityId?: string | null;
}) {
  const entityId = input?.entityId ?? null;
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc(
      'refresh_portfolio_operating_cadence_phase60',
      {
        p_actor_id: input?.actorId ?? null,
        p_entity_id: entityId,
      },
    );
    if (error) {
      return {
        ok: false as const,
        error: error.message,
        report: await getPortfolioOperatingCadencePhase60Report({ entityId }),
      };
    }
    return {
      ok: true as const,
      summary: (data as Record<string, unknown>) ?? {},
      report: await getPortfolioOperatingCadencePhase60Report({ entityId }),
      weekly_cadence: true as const,
    };
  } catch (caught) {
    return {
      ok: false as const,
      error:
        caught instanceof Error
          ? caught.message
          : 'Phase 60 portfolio refresh failed',
      report: await getPortfolioOperatingCadencePhase60Report({ entityId }),
    };
  }
}

export async function recordPortfolioRiskMilestonePhase60(input: {
  entityId?: string | null;
  portfolioId?: string | null;
  eventKind: string;
  title: string;
  status?: string;
  severity?: string;
  dueOn?: string | null;
  actorId?: string | null;
}) {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc(
      'record_portfolio_risk_milestone_phase60',
      {
        p_payload: {
          entity_id: input.entityId ?? null,
          portfolio_id: input.portfolioId ?? null,
          event_kind: input.eventKind,
          title: input.title,
          status: input.status ?? 'open',
          severity: input.severity ?? 'info',
          due_on: input.dueOn ?? null,
          actor_id: input.actorId ?? null,
          detail: {
            contract_version: PHASE60_PORTFOLIO_CONTRACT_VERSION,
          },
        },
      },
    );
    if (error) return { ok: false as const, error: error.message };
    return {
      ok: true as const,
      data: (data as Record<string, unknown>) ?? {},
    };
  } catch (caught) {
    return {
      ok: false as const,
      error:
        caught instanceof Error
          ? caught.message
          : 'Phase 60 risk/milestone record failed',
    };
  }
}

export async function recordPortfolioReviewPacketPhase60(input: {
  entityId?: string | null;
  portfolioId?: string | null;
  packetKind: string;
  title: string;
  periodKey?: string;
  completenessStatus?: string;
  actorId?: string | null;
}) {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc(
      'record_portfolio_review_packet_phase60',
      {
        p_payload: {
          entity_id: input.entityId ?? null,
          portfolio_id: input.portfolioId ?? null,
          packet_kind: input.packetKind,
          title: input.title,
          period_key: input.periodKey ?? null,
          completeness_status: input.completenessStatus ?? 'draft',
          actor_id: input.actorId ?? null,
          detail: {
            contract_version: PHASE60_PORTFOLIO_CONTRACT_VERSION,
            weekly_cadence: true,
          },
        },
      },
    );
    if (error) return { ok: false as const, error: error.message };
    return {
      ok: true as const,
      data: (data as Record<string, unknown>) ?? {},
    };
  } catch (caught) {
    return {
      ok: false as const,
      error:
        caught instanceof Error
          ? caught.message
          : 'Phase 60 review packet record failed',
    };
  }
}

import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  PHASE58_MARKETING_CONTRACT_VERSION,
  emptyMarketingHardeningPhase58Report,
  type MarketingBoardStatus,
  type MarketingHardeningPhase58Report,
  type PublishProposal,
  type RecruitAcquisitionEvent,
} from '@/lib/shared-services/marketing-hardening-phase58';

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

function asBoardStatus(value: unknown): MarketingBoardStatus {
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

function asProposals(value: unknown): PublishProposal[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      proposal_id: String(row.proposal_id ?? ''),
      entity_id: typeof row.entity_id === 'string' ? row.entity_id : null,
      action_kind: String(row.action_kind ?? 'other_money_impact'),
      summary: String(row.summary ?? ''),
      proposed_by: String(row.proposed_by ?? ''),
      status: String(row.status ?? 'pending'),
      created_at: String(row.created_at ?? ''),
    }))
    .filter((row) => row.proposal_id.length > 0);
}

function asRecruit(value: unknown): RecruitAcquisitionEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      event_id: typeof row.event_id === 'string' ? row.event_id : undefined,
      entity_id: String(row.entity_id ?? 'ENT-R619'),
      source_kind: String(row.source_kind ?? 'manual_stub'),
      applications: asCount(row.applications),
      clicks: asCount(row.clicks),
      spend_observe: asNumber(row.spend_observe),
      feed_status: asBoardStatus(row.feed_status),
      created_at: String(row.created_at ?? ''),
      todo: typeof row.todo === 'string' ? row.todo : null,
    }));
}

function normalizeReport(
  data: Record<string, unknown> | null | undefined,
  entityId: string | null,
): MarketingHardeningPhase58Report {
  const empty = emptyMarketingHardeningPhase58Report(entityId);
  if (!data) return empty;
  return {
    ...empty,
    entity_id:
      typeof data.entity_id === 'string'
        ? data.entity_id
        : data.entity_id === null
          ? null
          : entityId,
    in_review_count: asCount(data.in_review_count),
    overdue_count: asCount(data.overdue_count),
    due_soon_count: asCount(data.due_soon_count),
    approved_count: asCount(data.approved_count),
    sla_reliability_pct: asNumber(data.sla_reliability_pct),
    board_status: asBoardStatus(data.board_status),
    publishing_control_status: asBoardStatus(data.publishing_control_status),
    brand_voice_status: asBoardStatus(data.brand_voice_status),
    performance_status: asBoardStatus(data.performance_status),
    pending_jobs: asCount(data.pending_jobs),
    failed_jobs: asCount(data.failed_jobs),
    posted_jobs: asCount(data.posted_jobs),
    voices_configured: asCount(data.voices_configured),
    content_without_voice: asCount(data.content_without_voice),
    active_campaigns: asCount(data.active_campaigns),
    paid_campaigns: asCount(data.paid_campaigns),
    organic_campaigns: asCount(data.organic_campaigns),
    pending_publish_proposals: asCount(data.pending_publish_proposals),
    recruit_feed_status: asBoardStatus(data.recruit_feed_status),
    recruit_applications: asCount(data.recruit_applications),
    recruit_clicks: asCount(data.recruit_clicks),
    snapshot_id:
      typeof data.snapshot_id === 'string' ? data.snapshot_id : null,
    captured_at:
      typeof data.captured_at === 'string' ? data.captured_at : null,
    publish_proposals: asProposals(data.publish_proposals),
    recruit_acquisition: asRecruit(data.recruit_acquisition),
    recent_alerts: Array.isArray(data.recent_alerts)
      ? (data.recent_alerts as Array<Record<string, unknown>>)
      : [],
    entity_filter_hint: String(
      data.entity_filter_hint ?? empty.entity_filter_hint,
    ),
    todo: String(data.todo ?? empty.todo),
    money_auto_approved: false,
    publish_executed: false,
    dual_approve_required: true,
    never_auto_approve_money: true,
    contract_version: PHASE58_MARKETING_CONTRACT_VERSION,
  };
}

/** Fail-soft report fetch — empty stubs when RPC unavailable. */
export async function getMarketingHardeningPhase58Report(input?: {
  entityId?: string | null;
}): Promise<MarketingHardeningPhase58Report> {
  const entityId = input?.entityId ?? null;
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc(
      'get_marketing_hardening_phase58_report',
      { p_entity_id: entityId },
    );
    if (error) {
      console.error(
        'marketing hardening phase58 report unavailable',
        error.message,
      );
      return emptyMarketingHardeningPhase58Report(entityId);
    }
    return normalizeReport(
      (data as Record<string, unknown> | null) ?? null,
      entityId,
    );
  } catch (caught) {
    console.error(
      'marketing hardening phase58 report failed',
      caught instanceof Error ? caught.message : caught,
    );
    return emptyMarketingHardeningPhase58Report(entityId);
  }
}

export async function refreshMarketingHardeningPhase58(input?: {
  actorId?: string | null;
  entityId?: string | null;
}) {
  const entityId = input?.entityId ?? null;
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc(
      'refresh_marketing_hardening_phase58',
      {
        p_actor_id: input?.actorId ?? null,
        p_entity_id: entityId,
      },
    );
    if (error) {
      return {
        ok: false as const,
        error: error.message,
        report: await getMarketingHardeningPhase58Report({ entityId }),
      };
    }
    return {
      ok: true as const,
      summary: (data as Record<string, unknown>) ?? {},
      report: await getMarketingHardeningPhase58Report({ entityId }),
      money_auto_approved: false as const,
      publish_executed: false as const,
      never_auto_approve_money: true as const,
    };
  } catch (caught) {
    return {
      ok: false as const,
      error:
        caught instanceof Error
          ? caught.message
          : 'Phase 58 marketing refresh failed',
      report: await getMarketingHardeningPhase58Report({ entityId }),
    };
  }
}

export async function proposeMarketingPublishPhase58(input: {
  entityId?: string | null;
  actionKind: string;
  summary: string;
  proposedBy: string;
}) {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc('propose_marketing_publish_phase58', {
      p_payload: {
        entity_id: input.entityId ?? null,
        action_kind: input.actionKind,
        summary: input.summary,
        proposed_by: input.proposedBy,
        detail: {
          contract_version: PHASE58_MARKETING_CONTRACT_VERSION,
          money_auto_approved: false,
          publish_executed: false,
          dual_approve_required: true,
        },
      },
    });
    if (error) return { ok: false as const, error: error.message };
    return {
      ok: true as const,
      data: (data as Record<string, unknown>) ?? {},
      money_auto_approved: false as const,
      publish_executed: false as const,
    };
  } catch (caught) {
    return {
      ok: false as const,
      error:
        caught instanceof Error
          ? caught.message
          : 'Phase 58 publish proposal failed',
    };
  }
}

export async function approveMarketingPublishPhase58(input: {
  proposalId: string;
  actorId: string;
  decision: 'approve' | 'reject';
}) {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc('approve_marketing_publish_phase58', {
      p_proposal_id: input.proposalId,
      p_actor_id: input.actorId,
      p_decision: input.decision,
      p_detail: {
        contract_version: PHASE58_MARKETING_CONTRACT_VERSION,
        money_auto_approved: false,
        publish_executed: false,
      },
    });
    if (error) return { ok: false as const, error: error.message };
    return {
      ok: true as const,
      data: (data as Record<string, unknown>) ?? {},
      money_auto_approved: false as const,
      publish_executed: false as const,
    };
  } catch (caught) {
    return {
      ok: false as const,
      error:
        caught instanceof Error
          ? caught.message
          : 'Phase 58 publish approval failed',
    };
  }
}

export async function recordRecruitAcquisitionIntakePhase58(input: {
  entityId?: string | null;
  sourceKind?: string;
  applications?: number;
  clicks?: number;
  feedStatus?: string;
  actorId?: string | null;
}) {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc(
      'record_recruit_acquisition_intake_phase58',
      {
        p_payload: {
          entity_id: input.entityId ?? 'ENT-R619',
          source_kind: input.sourceKind ?? 'manual_stub',
          applications: input.applications ?? 0,
          clicks: input.clicks ?? 0,
          feed_status: input.feedStatus ?? 'missing',
          actor_id: input.actorId ?? null,
          detail: {
            contract_version: PHASE58_MARKETING_CONTRACT_VERSION,
            money_auto_approved: false,
            // TODO: wire JobTarget/job boards feed for ENT-R619
            todo: 'TODO: wire JobTarget/job boards feed for ENT-R619',
          },
        },
      },
    );
    if (error) return { ok: false as const, error: error.message };
    return {
      ok: true as const,
      data: (data as Record<string, unknown>) ?? {},
      money_auto_approved: false as const,
    };
  } catch (caught) {
    return {
      ok: false as const,
      error:
        caught instanceof Error
          ? caught.message
          : 'Phase 58 recruit acquisition intake failed',
    };
  }
}

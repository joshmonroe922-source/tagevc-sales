import { createPersistClient } from '@/lib/supabase/persist-client';

export const PHASE53_SUBSIDIARY_ROLLUP_CONTRACT_VERSION = 'phase53-v1';
export const PHASE53_RECRUIT_ENTITY_ID = 'ENT-R619';
export const PHASE53_RECRUIT_PORTAL_BASE = 'https://portal.recruit619.com';

export type SubsidiaryRollupFreshness =
  | 'fresh'
  | 'stale'
  | 'partial'
  | 'unknown';

export type SubsidiaryRollupFeedStatus =
  | 'ok'
  | 'partial'
  | 'missing'
  | 'unknown';

export type SubsidiaryRollupDrillDowns = {
  portal: string;
  reqs: string;
  pipeline: string;
  placements: string;
};

export type SubsidiaryRollupPhase53Report = {
  entity_id: string;
  canonical_name: string;
  open_reqs: number | null;
  pipeline_volume: number | null;
  submissions: number | null;
  interviews: number | null;
  offers: number | null;
  placements: number | null;
  source_mix: Record<string, number>;
  time_to_fill_days: number | null;
  time_to_place_days: number | null;
  freshness: SubsidiaryRollupFreshness;
  feed_status: SubsidiaryRollupFeedStatus;
  snapshot_id: string | null;
  captured_at: string | null;
  recent_alerts: Array<Record<string, unknown>>;
  drill_downs: SubsidiaryRollupDrillDowns;
  /** Explicit TODO until Recruit feed tables/APIs land. */
  todo: string;
  money_auto_approve: false;
  contract_version: typeof PHASE53_SUBSIDIARY_ROLLUP_CONTRACT_VERSION;
};

export function emptySubsidiaryRollupPhase53Report(
  entityId: string = PHASE53_RECRUIT_ENTITY_ID,
): SubsidiaryRollupPhase53Report {
  return {
    entity_id: entityId,
    canonical_name: entityId === PHASE53_RECRUIT_ENTITY_ID ? 'Recruit 619' : entityId,
    open_reqs: null,
    pipeline_volume: null,
    submissions: null,
    interviews: null,
    offers: null,
    placements: null,
    source_mix: {},
    time_to_fill_days: null,
    time_to_place_days: null,
    freshness: 'unknown',
    feed_status: 'missing',
    snapshot_id: null,
    captured_at: null,
    recent_alerts: [],
    drill_downs: {
      portal: PHASE53_RECRUIT_PORTAL_BASE,
      reqs: `${PHASE53_RECRUIT_PORTAL_BASE}/jobs`,
      pipeline: `${PHASE53_RECRUIT_PORTAL_BASE}/pipeline`,
      placements: `${PHASE53_RECRUIT_PORTAL_BASE}/placements`,
    },
    todo: 'Awaiting live Recruit feed row in os_recruit_feed_metrics',
    money_auto_approve: false,
    contract_version: PHASE53_SUBSIDIARY_ROLLUP_CONTRACT_VERSION,
  };
}

type LiveRecruitFeedRow = {
  id: string;
  as_of: string;
  payload: Record<string, unknown> | null;
  source: string | null;
};

function feedFreshness(asOf: string | null): SubsidiaryRollupFreshness {
  if (!asOf) return 'unknown';
  const ageMs = Date.now() - new Date(asOf).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'unknown';
  if (ageMs <= 6 * 60 * 60 * 1000) return 'fresh';
  if (ageMs <= 48 * 60 * 60 * 1000) return 'stale';
  return 'partial';
}

/** Map Phase 55 jsonb feed payload → Phase 53 rollup metrics. */
export function mergeLiveRecruitFeedIntoReport(
  report: SubsidiaryRollupPhase53Report,
  feed: LiveRecruitFeedRow | null | undefined,
): SubsidiaryRollupPhase53Report {
  if (!feed?.payload || typeof feed.payload !== 'object') return report;

  const p = feed.payload;
  const openReqs = asNumber(p.openJobs);
  const pipeline = asNumber(p.openApplications);
  const placements = asNumber(p.placementsStarted);
  const pendingStart = asNumber(p.placementsPendingStart);
  const accounts = asNumber(p.accountsImported);
  const contacts = asNumber(p.contactsImported);

  const hasAny =
    openReqs != null ||
    pipeline != null ||
    placements != null ||
    pendingStart != null;

  if (!hasAny && report.feed_status === 'ok') return report;

  const alerts = [...report.recent_alerts];
  if (pendingStart != null && pendingStart > 0) {
    alerts.unshift({
      kind: 'placements_pending_start',
      count: pendingStart,
      source: feed.source ?? 'recruit_portal',
    });
  }

  return {
    ...report,
    open_reqs: openReqs ?? report.open_reqs,
    pipeline_volume: pipeline ?? report.pipeline_volume,
    placements: placements ?? report.placements,
    // Until Recruit sends submission/interview/offer splits, keep nulls.
    freshness: feedFreshness(feed.as_of),
    feed_status: hasAny ? 'ok' : 'partial',
    snapshot_id: feed.id,
    captured_at: feed.as_of,
    recent_alerts: alerts.slice(0, 8),
    source_mix: {
      ...report.source_mix,
      recruit_portal: 1,
      ...(accounts != null ? { accounts_imported: accounts } : {}),
      ...(contacts != null ? { contacts_imported: contacts } : {}),
    },
    todo: hasAny
      ? 'Live Recruit portal feed (os_recruit_feed_metrics). Deeper KPI splits land as Recruit expands the payload.'
      : report.todo,
  };
}

async function fetchLatestRecruitFeed(
  entityId: string,
): Promise<LiveRecruitFeedRow | null> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_recruit_feed_metrics')
      .select('id, as_of, payload, source')
      .eq('entity_id', entityId)
      .order('as_of', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: String(data.id),
      as_of: String(data.as_of),
      payload: (data.payload as Record<string, unknown> | null) ?? null,
      source: (data.source as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function asSourceMix(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const n = asNumber(raw);
    if (n != null && n >= 0) out[key] = n;
  }
  return out;
}

function normalizeReport(
  data: Record<string, unknown> | null | undefined,
  entityId: string,
): SubsidiaryRollupPhase53Report {
  const empty = emptySubsidiaryRollupPhase53Report(entityId);
  if (!data) return empty;

  const freshnessRaw = String(data.freshness ?? 'unknown');
  const freshness: SubsidiaryRollupFreshness =
    freshnessRaw === 'fresh' ||
    freshnessRaw === 'stale' ||
    freshnessRaw === 'partial' ||
    freshnessRaw === 'unknown'
      ? freshnessRaw
      : 'unknown';

  const feedRaw = String(data.feed_status ?? 'missing');
  const feed_status: SubsidiaryRollupFeedStatus =
    feedRaw === 'ok' ||
    feedRaw === 'partial' ||
    feedRaw === 'missing' ||
    feedRaw === 'unknown'
      ? feedRaw
      : 'unknown';

  const drills =
    data.drill_downs && typeof data.drill_downs === 'object'
      ? (data.drill_downs as Record<string, unknown>)
      : {};

  return {
    ...empty,
    entity_id: String(data.entity_id ?? entityId),
    canonical_name: String(data.canonical_name ?? empty.canonical_name),
    open_reqs: asNumber(data.open_reqs),
    pipeline_volume: asNumber(data.pipeline_volume),
    submissions: asNumber(data.submissions),
    interviews: asNumber(data.interviews),
    offers: asNumber(data.offers),
    placements: asNumber(data.placements),
    source_mix: asSourceMix(data.source_mix),
    time_to_fill_days: asNumber(data.time_to_fill_days),
    time_to_place_days: asNumber(data.time_to_place_days),
    freshness,
    feed_status,
    snapshot_id:
      typeof data.snapshot_id === 'string' ? data.snapshot_id : null,
    captured_at:
      typeof data.captured_at === 'string' ? data.captured_at : null,
    recent_alerts: Array.isArray(data.recent_alerts)
      ? (data.recent_alerts as Array<Record<string, unknown>>)
      : [],
    drill_downs: {
      portal: String(drills.portal ?? empty.drill_downs.portal),
      reqs: String(drills.reqs ?? empty.drill_downs.reqs),
      pipeline: String(drills.pipeline ?? empty.drill_downs.pipeline),
      placements: String(drills.placements ?? empty.drill_downs.placements),
    },
    todo: String(data.todo ?? empty.todo),
    money_auto_approve: false,
    contract_version: PHASE53_SUBSIDIARY_ROLLUP_CONTRACT_VERSION,
  };
}

/** Fail-soft report fetch — returns empty metrics with freshness=unknown on error. */
export async function getSubsidiaryRollupPhase53Report(
  entityId: string = PHASE53_RECRUIT_ENTITY_ID,
): Promise<SubsidiaryRollupPhase53Report> {
  let base = emptySubsidiaryRollupPhase53Report(entityId);
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc(
      'get_subsidiary_rollup_phase53_report',
      { p_entity_id: entityId },
    );
    if (error) {
      console.error(
        'subsidiary rollup phase53 report unavailable',
        error.message,
      );
    } else {
      base = normalizeReport(
        (data as Record<string, unknown> | null) ?? null,
        entityId,
      );
    }
  } catch (caught) {
    console.error(
      'subsidiary rollup phase53 report failed',
      caught instanceof Error ? caught.message : caught,
    );
  }

  // Phase 55 stores compact jsonb payloads; prefer those over empty RPC snapshots.
  if (entityId === PHASE53_RECRUIT_ENTITY_ID) {
    const live = await fetchLatestRecruitFeed(entityId);
    base = mergeLiveRecruitFeedIntoReport(base, live);
  }
  return base;
}

export async function refreshSubsidiaryRollupPhase53(input?: {
  actorId?: string | null;
  entityId?: string;
}) {
  const entityId = input?.entityId ?? PHASE53_RECRUIT_ENTITY_ID;
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc(
      'refresh_subsidiary_rollup_phase53',
      {
        p_actor_id: input?.actorId ?? null,
        p_entity_id: entityId,
      },
    );
    if (error) {
      return {
        ok: false as const,
        money_auto_approve: false as const,
        contract_version: PHASE53_SUBSIDIARY_ROLLUP_CONTRACT_VERSION,
        error: error.message,
        report: emptySubsidiaryRollupPhase53Report(entityId),
      };
    }
    return {
      ok: true as const,
      money_auto_approve: false as const,
      contract_version: PHASE53_SUBSIDIARY_ROLLUP_CONTRACT_VERSION,
      summary: data as Record<string, unknown>,
      report: await getSubsidiaryRollupPhase53Report(entityId),
    };
  } catch (caught) {
    return {
      ok: false as const,
      money_auto_approve: false as const,
      contract_version: PHASE53_SUBSIDIARY_ROLLUP_CONTRACT_VERSION,
      error:
        caught instanceof Error
          ? caught.message
          : 'Phase 53 subsidiary rollup refresh failed',
      report: emptySubsidiaryRollupPhase53Report(entityId),
    };
  }
}

export function isRecruitRollupEntity(entityId: string | null | undefined) {
  return entityId === PHASE53_RECRUIT_ENTITY_ID;
}

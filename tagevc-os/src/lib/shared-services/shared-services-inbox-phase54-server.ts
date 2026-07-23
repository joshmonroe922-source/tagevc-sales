import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  PHASE54_SS_INBOX_CONTRACT_VERSION,
  emptySharedServicesInboxPhase54Report,
  type SharedServicesInboxPhase54Report,
} from '@/lib/shared-services/shared-services-inbox-phase54';

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
}

function asCountMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const n = asNumber(raw);
    if (n >= 0) out[key] = n;
  }
  return out;
}

function asModuleStubs(
  value: unknown,
): SharedServicesInboxPhase54Report['module_stubs'] {
  const empty = emptySharedServicesInboxPhase54Report();
  if (!Array.isArray(value) || value.length === 0) return empty.module_stubs;
  const out: SharedServicesInboxPhase54Report['module_stubs'] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const service = String(r.service ?? '');
    if (!['Finance', 'Legal', 'HR', 'IT', 'Marketing'].includes(service)) {
      continue;
    }
    const statusRaw = String(r.status ?? 'planned');
    const status =
      statusRaw === 'live' || statusRaw === 'foundation' || statusRaw === 'planned'
        ? statusRaw
        : 'planned';
    out.push({
      service: service as SharedServicesInboxPhase54Report['module_stubs'][number]['service'],
      href: String(r.href ?? '/shared-services'),
      status,
      todo: typeof r.todo === 'string' ? r.todo : null,
    });
  }
  return out.length ? out : empty.module_stubs;
}

function asEscalations(
  value: unknown,
): SharedServicesInboxPhase54Report['recent_escalations'] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      escalation_id:
        typeof row.escalation_id === 'string' ? row.escalation_id : undefined,
      ticket_id: String(row.ticket_id ?? ''),
      entity_id: typeof row.entity_id === 'string' ? row.entity_id : null,
      service: String(row.service ?? ''),
      priority: typeof row.priority === 'string' ? row.priority : null,
      sla_status: String(row.sla_status ?? 'escalated'),
      owner_name: typeof row.owner_name === 'string' ? row.owner_name : null,
      severity: String(row.severity ?? 'warning'),
      created_at: String(row.created_at ?? ''),
    }))
    .filter((e) => e.ticket_id.length > 0);
}

function normalizeReport(
  data: Record<string, unknown> | null | undefined,
  entityId: string | null,
  serviceFilter: string | null,
): SharedServicesInboxPhase54Report {
  const empty = emptySharedServicesInboxPhase54Report(entityId, serviceFilter);
  if (!data) return empty;

  const feedRaw = String(data.feed_status ?? 'missing');
  const feed_status =
    feedRaw === 'ok' ||
    feedRaw === 'partial' ||
    feedRaw === 'missing' ||
    feedRaw === 'unknown'
      ? feedRaw
      : 'unknown';

  return {
    ...empty,
    entity_id:
      typeof data.entity_id === 'string'
        ? data.entity_id
        : data.entity_id === null
          ? null
          : entityId,
    service_filter:
      typeof data.service_filter === 'string'
        ? data.service_filter
        : data.service_filter === null
          ? null
          : serviceFilter,
    open_total: asNumber(data.open_total),
    by_service: asCountMap(data.by_service),
    by_sla_status: asCountMap(data.by_sla_status),
    by_entity: asCountMap(data.by_entity),
    escalated_count: asNumber(data.escalated_count),
    breached_count: asNumber(data.breached_count),
    due_soon_count: asNumber(data.due_soon_count),
    unassigned_count: asNumber(data.unassigned_count),
    feed_status,
    snapshot_id:
      typeof data.snapshot_id === 'string' ? data.snapshot_id : null,
    captured_at:
      typeof data.captured_at === 'string' ? data.captured_at : null,
    recent_escalations: asEscalations(data.recent_escalations),
    recent_alerts: Array.isArray(data.recent_alerts)
      ? (data.recent_alerts as Array<Record<string, unknown>>)
      : [],
    module_stubs: asModuleStubs(data.module_stubs),
    entity_filter_hint: String(
      data.entity_filter_hint ?? empty.entity_filter_hint,
    ),
    todo: String(data.todo ?? empty.todo),
    money_auto_approve: false,
    contract_version: PHASE54_SS_INBOX_CONTRACT_VERSION,
  };
}

/** Fail-soft report fetch — empty board when RPC unavailable. Server-only. */
export async function getSharedServicesInboxPhase54Report(input?: {
  entityId?: string | null;
  service?: string | null;
}): Promise<SharedServicesInboxPhase54Report> {
  const entityId = input?.entityId ?? null;
  const service = input?.service ?? null;
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc(
      'get_shared_services_inbox_phase54_report',
      {
        p_entity_id: entityId,
        p_service: service,
      },
    );
    if (error) {
      console.error(
        'shared services inbox phase54 report unavailable',
        error.message,
      );
      return emptySharedServicesInboxPhase54Report(entityId, service);
    }
    return normalizeReport(
      (data as Record<string, unknown> | null) ?? null,
      entityId,
      service,
    );
  } catch (caught) {
    console.error(
      'shared services inbox phase54 report failed',
      caught instanceof Error ? caught.message : caught,
    );
    return emptySharedServicesInboxPhase54Report(entityId, service);
  }
}

export async function refreshSharedServicesInboxPhase54(input?: {
  actorId?: string | null;
  entityId?: string | null;
}) {
  const entityId = input?.entityId ?? null;
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc(
      'refresh_shared_services_inbox_phase54',
      {
        p_actor_id: input?.actorId ?? null,
        p_entity_id: entityId,
      },
    );
    if (error) {
      return {
        ok: false as const,
        money_auto_approve: false as const,
        contract_version: PHASE54_SS_INBOX_CONTRACT_VERSION,
        error: error.message,
        report: emptySharedServicesInboxPhase54Report(entityId),
      };
    }
    return {
      ok: true as const,
      money_auto_approve: false as const,
      contract_version: PHASE54_SS_INBOX_CONTRACT_VERSION,
      summary: data as Record<string, unknown>,
      report: await getSharedServicesInboxPhase54Report({ entityId }),
    };
  } catch (caught) {
    return {
      ok: false as const,
      money_auto_approve: false as const,
      contract_version: PHASE54_SS_INBOX_CONTRACT_VERSION,
      error:
        caught instanceof Error
          ? caught.message
          : 'Phase 54 Shared Services inbox refresh failed',
      report: emptySharedServicesInboxPhase54Report(entityId),
    };
  }
}

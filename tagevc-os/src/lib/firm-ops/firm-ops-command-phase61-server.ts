import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  PHASE61_FIRM_OPS_CONTRACT_VERSION,
  emptyFirmOpsCommandPhase61Report,
  type FirmOpsActionQueue,
  type FirmOpsBoardStatus,
  type FirmOpsCommandPhase61Report,
  type FirmOpsModuleLink,
  type FirmOpsQueueItem,
} from '@/lib/firm-ops/firm-ops-command-phase61';

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

function asBoardStatus(value: unknown): FirmOpsBoardStatus {
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

function asCountMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    out[key] = asCount(raw);
  }
  return out;
}

function asQueueItems(value: unknown): FirmOpsQueueItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      id: String(row.id ?? ''),
      title: String(row.title ?? ''),
      href: String(row.href ?? '#'),
      count: asCount(row.count),
      severity: String(row.severity ?? 'info'),
    }))
    .filter((row) => row.id.length > 0 || row.title.length > 0);
}

function asQueues(value: unknown): FirmOpsActionQueue[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      snapshot_id:
        typeof row.snapshot_id === 'string' ? row.snapshot_id : null,
      audience: String(row.audience ?? ''),
      open_count: asCount(row.open_count),
      overdue_count: asCount(row.overdue_count),
      queue_items: asQueueItems(row.queue_items),
      board_status: asBoardStatus(row.board_status),
      created_at: typeof row.created_at === 'string' ? row.created_at : null,
    }))
    .filter((row) => row.audience.length > 0);
}

function asModules(value: unknown): FirmOpsModuleLink[] {
  const empty = emptyFirmOpsCommandPhase61Report().modules;
  if (!Array.isArray(value) || value.length === 0) return empty;
  const mapped = value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      module_key: String(row.module_key ?? ''),
      href: String(row.href ?? '#'),
      label: String(row.label ?? row.module_key ?? ''),
      priority: asCount(row.priority) || 99,
      link_status: asBoardStatus(row.link_status),
    }))
    .filter((row) => row.module_key.length > 0)
    .sort((a, b) => a.priority - b.priority);
  return mapped.length > 0 ? mapped : empty;
}

function normalizeReport(
  data: Record<string, unknown> | null | undefined,
  entityId: string | null,
): FirmOpsCommandPhase61Report {
  const empty = emptyFirmOpsCommandPhase61Report(entityId);
  if (!data) return empty;
  return {
    ...empty,
    entity_id:
      typeof data.entity_id === 'string'
        ? data.entity_id
        : data.entity_id === null
          ? null
          : entityId,
    critical_count: asCount(data.critical_count),
    warning_count: asCount(data.warning_count),
    info_count: asCount(data.info_count),
    by_service: asCountMap(data.by_service),
    alert_board_status: asBoardStatus(data.alert_board_status),
    stale_count: asCount(data.stale_count),
    breach_count: asCount(data.breach_count),
    by_domain: asCountMap(data.by_domain),
    stale_board_status: asBoardStatus(data.stale_board_status),
    snapshot_id:
      typeof data.snapshot_id === 'string' ? data.snapshot_id : null,
    captured_at:
      typeof data.captured_at === 'string' ? data.captured_at : null,
    queues: asQueues(data.queues),
    modules: asModules(data.modules),
    recent_alerts: Array.isArray(data.recent_alerts)
      ? (data.recent_alerts as Array<Record<string, unknown>>)
      : [],
    entity_filter_hint: String(
      data.entity_filter_hint ?? empty.entity_filter_hint,
    ),
    todo: String(data.todo ?? empty.todo),
    money_auto_approve: false,
    firm_ops_command: true,
    contract_version: PHASE61_FIRM_OPS_CONTRACT_VERSION,
  };
}

/** Fail-soft report fetch — empty stubs when RPC unavailable. */
export async function getFirmOpsCommandPhase61Report(input?: {
  entityId?: string | null;
}): Promise<FirmOpsCommandPhase61Report> {
  const entityId = input?.entityId ?? null;
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc(
      'get_firm_ops_command_phase61_report',
      { p_entity_id: entityId },
    );
    if (error) {
      console.error(
        'firm ops command phase61 report unavailable',
        error.message,
      );
      return emptyFirmOpsCommandPhase61Report(entityId);
    }
    return normalizeReport(
      (data as Record<string, unknown> | null) ?? null,
      entityId,
    );
  } catch (caught) {
    console.error(
      'firm ops command phase61 report failed',
      caught instanceof Error ? caught.message : caught,
    );
    return emptyFirmOpsCommandPhase61Report(entityId);
  }
}

export async function refreshFirmOpsCommandPhase61(input?: {
  actorId?: string | null;
  entityId?: string | null;
}) {
  const entityId = input?.entityId ?? null;
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb.rpc('refresh_firm_ops_command_phase61', {
      p_actor_id: input?.actorId ?? null,
      p_entity_id: entityId,
    });
    if (error) {
      return {
        ok: false as const,
        error: error.message,
        report: await getFirmOpsCommandPhase61Report({ entityId }),
      };
    }
    return {
      ok: true as const,
      summary: (data as Record<string, unknown>) ?? {},
      report: await getFirmOpsCommandPhase61Report({ entityId }),
      firm_ops_command: true as const,
      money_auto_approve: false as const,
    };
  } catch (caught) {
    return {
      ok: false as const,
      error:
        caught instanceof Error
          ? caught.message
          : 'Phase 61 firm ops refresh failed',
      report: await getFirmOpsCommandPhase61Report({ entityId }),
    };
  }
}

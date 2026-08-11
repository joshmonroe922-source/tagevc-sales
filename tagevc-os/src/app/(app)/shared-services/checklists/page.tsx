import { SscChecklistClient } from '@/components/shared-services/ssc-checklist-client';
import { getSscOperatorBundle } from '@/lib/shared-services/ssc-checklist/engine';
import type {
  SscFunction,
  SscPeriodType,
  SscScopeMode,
  SscTaskStatus,
} from '@/lib/shared-services/ssc-checklist/types';
import {
  SSC_FUNCTIONS,
  SSC_PERIOD_TYPES,
  SSC_SCOPE_MODES,
  SSC_TASK_STATUSES,
} from '@/lib/shared-services/ssc-checklist/types';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { roleHasPermission } from '@/lib/types/roles';

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(
  raw: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function parseFunction(raw?: string): SscFunction | 'all' {
  if (raw === 'all') return 'all';
  if (raw && (SSC_FUNCTIONS as readonly string[]).includes(raw)) {
    return raw as SscFunction;
  }
  return 'all';
}

function parsePeriod(raw?: string): SscPeriodType {
  if (raw && (SSC_PERIOD_TYPES as readonly string[]).includes(raw)) {
    return raw as SscPeriodType;
  }
  return 'monthly';
}

function parseScope(raw?: string): SscScopeMode {
  if (raw && (SSC_SCOPE_MODES as readonly string[]).includes(raw)) {
    return raw as SscScopeMode;
  }
  return 'parent_subs';
}

function parseTime(raw?: string): 'active' | 'future' {
  if (raw === 'future') return 'future';
  return 'active';
}

export default async function SscChecklistsPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const params = (await searchParams) ?? {};
  const ctx = await getSessionContext();
  const firmWide = ctx
    ? isFirmWideAccess(
        ctx.profile.role,
        ctx.profile.entity_id,
        ctx.activeEntityOs,
      )
    : false;

  let scope = parseScope(firstParam(params.scope));
  let single = firstParam(params.entity)?.trim() || null;
  if (!firmWide) {
    scope = 'single';
    single = ctx?.profile.entity_id ?? single;
  }

  const statusRaw = firstParam(params.status)?.trim();
  const status =
    statusRaw &&
    (statusRaw === 'all' ||
      (SSC_TASK_STATUSES as readonly string[]).includes(statusRaw))
      ? (statusRaw as SscTaskStatus | 'all')
      : 'all';

  const bundle = await getSscOperatorBundle({
    function: parseFunction(firstParam(params.function)),
    period_type: parsePeriod(firstParam(params.period)),
    scope_mode: scope,
    single_entity_id: single,
    time_nav: parseTime(firstParam(params.time)),
    status,
    owner_role: firstParam(params.owner)?.trim() || 'all',
    company_entity_id: firstParam(params.company)?.trim() || 'all',
    risk: firstParam(params.risk) === 'high_plus' ? 'high_plus' : 'all',
    overdue_only: firstParam(params.overdue) === '1',
  });

  const canWrite = ctx
    ? roleHasPermission(ctx.profile.role, 'write:shared_services')
    : false;

  const focusTaskId = firstParam(params.task)?.trim() || null;

  return (
    <SscChecklistClient
      bundle={bundle}
      canWrite={canWrite}
      mode="checklists"
      focusTaskId={focusTaskId}
    />
  );
}

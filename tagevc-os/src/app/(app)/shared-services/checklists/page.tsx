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
  searchParams?: Promise<Record<string, string | undefined>>;
};

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

function parseTime(raw?: string): 'past' | 'current' | 'future' {
  if (raw === 'past' || raw === 'future') return raw;
  return 'current';
}

export default async function SscChecklistsPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const params = (await searchParams) ?? {};
  const ctx = await getSessionContext();
  const firmWide = ctx
    ? isFirmWideAccess(ctx.profile.role, ctx.profile.entity_id)
    : false;

  let scope = parseScope(params.scope);
  let single = params.entity?.trim() || null;
  if (!firmWide) {
    scope = 'single';
    single = ctx?.profile.entity_id ?? single;
  }

  const statusRaw = params.status?.trim();
  const status =
    statusRaw &&
    (statusRaw === 'all' ||
      (SSC_TASK_STATUSES as readonly string[]).includes(statusRaw))
      ? (statusRaw as SscTaskStatus | 'all')
      : 'all';

  const bundle = await getSscOperatorBundle({
    function: parseFunction(params.function),
    period_type: parsePeriod(params.period),
    scope_mode: scope,
    single_entity_id: single,
    time_nav: parseTime(params.time),
    status,
    owner_role: params.owner?.trim() || 'all',
    company_entity_id: params.company?.trim() || 'all',
    risk: params.risk === 'high_plus' ? 'high_plus' : 'all',
  });

  const canWrite = ctx
    ? roleHasPermission(ctx.profile.role, 'write:shared_services')
    : false;

  return (
    <SscChecklistClient bundle={bundle} canWrite={canWrite} mode="checklists" />
  );
}

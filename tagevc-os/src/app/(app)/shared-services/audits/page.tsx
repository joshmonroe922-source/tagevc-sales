import { SscChecklistClient } from '@/components/shared-services/ssc-checklist-client';
import { getSscOperatorBundle } from '@/lib/shared-services/ssc-checklist/engine';
import type {
  SscFunction,
  SscPeriodType,
  SscScopeMode,
} from '@/lib/shared-services/ssc-checklist/types';
import {
  SSC_FUNCTIONS,
  SSC_PERIOD_TYPES,
  SSC_SCOPE_MODES,
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
  return 'annual';
}

function parseScope(raw?: string): SscScopeMode {
  if (raw && (SSC_SCOPE_MODES as readonly string[]).includes(raw)) {
    return raw as SscScopeMode;
  }
  return 'parent_subs';
}

export default async function SscAuditsPage({ searchParams }: Props) {
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

  const bundle = await getSscOperatorBundle({
    function: parseFunction(params.function),
    period_type: parsePeriod(params.period),
    scope_mode: scope,
    single_entity_id: single,
    time_nav:
      params.time === 'future' ? 'future' : 'active',
  });

  const canWrite = ctx
    ? roleHasPermission(ctx.profile.role, 'write:shared_services')
    : false;

  return (
    <SscChecklistClient bundle={bundle} canWrite={canWrite} mode="audits" />
  );
}

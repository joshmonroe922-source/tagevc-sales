'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  ensureMasterData,
  patchEntity,
  patchEntityMonthKpi,
  patchEntityMonthKpiFlex,
  patchPortfolioCompany,
  patchPortfolioCoreFinancials,
} from '@/lib/data/master-data';
import { EDITABLE_CORE_KPI_KEYS } from '@/lib/portfolio/core-kpis';
import {
  PHASE60_PORTFOLIO_CONTRACT_VERSION,
  type PortfolioOperatingCadencePhase60Report,
} from '@/lib/portfolio/operating-cadence-phase60';
import {
  getPortfolioOperatingCadencePhase60Report,
  recordPortfolioReviewPacketPhase60,
  recordPortfolioRiskMilestonePhase60,
  refreshPortfolioOperatingCadencePhase60,
} from '@/lib/portfolio/operating-cadence-phase60-server';
import {
  buildParentIndex,
  canAccessEntityId,
  entityScopeDeniedMessage,
} from '@/lib/rbac/entity-scope';
import { guardPermission } from '@/lib/rbac/session';
import { captureException } from '@/lib/observability';
import { ENTITY_STATUSES, PORTFOLIO_HEALTH } from '@/lib/types';

export type MasterDataActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

const portfolioSchema = z.object({
  portfolio_id: z.string().min(1),
  health: z.enum(PORTFOLIO_HEALTH),
  top_risk: z.string().max(500).optional(),
  next_milestone: z.string().max(500).optional(),
  notes: z.string().max(4000).optional(),
  coo_owner: z.string().max(200).optional(),
});

const entitySchema = z.object({
  entity_id: z.string().min(1),
  notes: z.string().max(4000).optional(),
  coo_owner: z.string().max(200).optional(),
  board_lead: z.string().max(200).optional(),
  status: z.enum(ENTITY_STATUSES).optional(),
});

const coreFinancialSchema = z.object({
  portfolio_id: z.string().min(1),
  arr_k: z.coerce.number().finite().min(0),
  net_burn_k: z.coerce.number().finite().min(0),
  cash_k: z.coerce.number().finite().min(0),
  runway_mo: z.coerce.number().finite().min(0).optional().nullable(),
  mom_growth: z.coerce.number().finite().optional().nullable(),
  cogs_k: z.coerce.number().finite().min(0).optional(),
  opex_k: z.coerce.number().finite().min(0).optional(),
});

function emptyToNull(value: string | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseOptionalNumber(raw: FormDataEntryValue | null): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function revalidateMaster(entityId: string, portfolioId?: string | null) {
  revalidatePath('/portfolio');
  revalidatePath('/entities');
  revalidatePath('/command-center');
  revalidatePath(`/entities/${entityId}`);
  if (portfolioId) revalidatePath(`/portfolio/${portfolioId}`);
}

async function assertEntityAccess(
  role: Parameters<typeof canAccessEntityId>[0],
  profileEntityId: string | null | undefined,
  targetEntityId: string,
): Promise<MasterDataActionResult | null> {
  const master = await ensureMasterData();
  const parents = buildParentIndex(master.entities);
  if (!canAccessEntityId(role, profileEntityId, targetEntityId, parents)) {
    return { ok: false, error: entityScopeDeniedMessage(targetEntityId) };
  }
  return null;
}

export async function updatePortfolioPulseAction(
  _prev: MasterDataActionResult | null,
  formData: FormData,
): Promise<MasterDataActionResult> {
  const gate = await guardPermission('write:portfolio_health');
  if (!gate.ok) return gate;

  const parsed = portfolioSchema.safeParse({
    portfolio_id: formData.get('portfolio_id'),
    health: formData.get('health'),
    top_risk: formData.get('top_risk') || undefined,
    next_milestone: formData.get('next_milestone') || undefined,
    notes: formData.get('notes') || undefined,
    coo_owner: formData.get('coo_owner') || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  try {
    const master = await ensureMasterData();
    const existing = master.companies.find(
      (c) => c.portfolio_id === parsed.data.portfolio_id,
    );
    if (!existing) {
      return { ok: false, error: 'Unknown portfolio company' };
    }
    const denied = await assertEntityAccess(
      gate.profile.role,
      gate.profile.entity_id,
      existing.entity_id,
    );
    if (denied) return denied;

    const company = await patchPortfolioCompany(parsed.data.portfolio_id, {
      health: parsed.data.health,
      top_risk: emptyToNull(parsed.data.top_risk),
      next_milestone: emptyToNull(parsed.data.next_milestone),
      notes: emptyToNull(parsed.data.notes),
      coo_owner: emptyToNull(parsed.data.coo_owner),
    });
    revalidateMaster(company.entity_id, company.portfolio_id);
    return { ok: true, message: 'Portfolio pulse saved' };
  } catch (e) {
    captureException(e, { action: 'updatePortfolioPulseAction' });
    return { ok: false, error: e instanceof Error ? e.message : 'Save failed' };
  }
}

export async function updateEntityNotesAction(
  _prev: MasterDataActionResult | null,
  formData: FormData,
): Promise<MasterDataActionResult> {
  const gate = await guardPermission('write:portfolio_health');
  if (!gate.ok) return gate;

  const parsed = entitySchema.safeParse({
    entity_id: formData.get('entity_id'),
    notes: formData.get('notes') || undefined,
    coo_owner: formData.get('coo_owner') || undefined,
    board_lead: formData.get('board_lead') || undefined,
    status: formData.get('status') || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  try {
    const denied = await assertEntityAccess(
      gate.profile.role,
      gate.profile.entity_id,
      parsed.data.entity_id,
    );
    if (denied) return denied;

    const entity = await patchEntity(parsed.data.entity_id, {
      notes: emptyToNull(parsed.data.notes),
      coo_owner: emptyToNull(parsed.data.coo_owner),
      board_lead: emptyToNull(parsed.data.board_lead),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
    });
    revalidateMaster(entity.entity_id, entity.portfolio_id);
    return { ok: true, message: 'Entity Master saved' };
  } catch (e) {
    captureException(e, { action: 'updateEntityNotesAction' });
    return { ok: false, error: e instanceof Error ? e.message : 'Save failed' };
  }
}

/**
 * CORE financial edit with rollup guards:
 * - Portfolio Active CORE $ and same-period P&L stay aligned
 * - Runway auto-derived from cash/burn when burn > 0 and runway omitted
 * - Append-only audit when os_financial_audits exists
 */
export async function updatePortfolioCoreFinancialsAction(
  _prev: MasterDataActionResult | null,
  formData: FormData,
): Promise<MasterDataActionResult> {
  const gate = await guardPermission('write:portfolio_health');
  if (!gate.ok) return gate;

  const runwayRaw = formData.get('runway_mo');
  const momRaw = formData.get('mom_growth');
  const parsed = coreFinancialSchema.safeParse({
    portfolio_id: formData.get('portfolio_id'),
    arr_k: formData.get('arr_k'),
    net_burn_k: formData.get('net_burn_k'),
    cash_k: formData.get('cash_k'),
    runway_mo: runwayRaw === '' || runwayRaw == null ? null : runwayRaw,
    mom_growth: momRaw === '' || momRaw == null ? null : momRaw,
    cogs_k: formData.get('cogs_k') || undefined,
    opex_k: formData.get('opex_k') || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  try {
    const master = await ensureMasterData();
    const existing = master.companies.find(
      (c) => c.portfolio_id === parsed.data.portfolio_id,
    );
    if (!existing) {
      return { ok: false, error: 'Unknown portfolio company' };
    }
    const denied = await assertEntityAccess(
      gate.profile.role,
      gate.profile.entity_id,
      existing.entity_id,
    );
    if (denied) return denied;

    let runway_mo = parsed.data.runway_mo ?? null;
    if (parsed.data.net_burn_k <= 0) {
      runway_mo = null;
    } else if (runway_mo == null) {
      runway_mo =
        Math.round((parsed.data.cash_k / parsed.data.net_burn_k) * 10) / 10;
    }

    // MoM growth UI is percent (12 = 12%); store as decimal
    let mom_growth = parseOptionalNumber(momRaw);
    if (mom_growth != null && Math.abs(mom_growth) > 1) {
      mom_growth = mom_growth / 100;
    }

    const { company } = await patchPortfolioCoreFinancials(
      parsed.data.portfolio_id,
      {
        arr_k: parsed.data.arr_k,
        net_burn_k: parsed.data.net_burn_k,
        cash_k: parsed.data.cash_k,
        runway_mo,
        mom_growth,
        cogs_k: parsed.data.cogs_k,
        opex_k: parsed.data.opex_k,
      },
      {
        actorId: gate.profile.id,
        actorEmail: gate.profile.email ?? null,
      },
    );
    revalidateMaster(company.entity_id, company.portfolio_id);
    return {
      ok: true,
      message: 'CORE financials saved · P&L aligned for roll-up',
    };
  } catch (e) {
    captureException(e, { action: 'updatePortfolioCoreFinancialsAction' });
    return { ok: false, error: e instanceof Error ? e.message : 'Save failed' };
  }
}

const coreKpiSchema = z.object({
  entity_id: z.string().min(1),
  kpi_key: z.enum(EDITABLE_CORE_KPI_KEYS),
  value_num: z.coerce.number().finite().optional().nullable(),
  value_text: z.string().max(500).optional().nullable(),
});

const flexKpiSchema = z.object({
  entity_id: z.string().min(1),
  flex_key: z.string().min(1).max(80),
  value_num: z.coerce.number().finite().optional().nullable(),
  value_text: z.string().max(500).optional().nullable(),
});

export async function updateCoreKpiAction(
  _prev: MasterDataActionResult | null,
  formData: FormData,
): Promise<MasterDataActionResult> {
  const gate = await guardPermission('write:portfolio_health');
  if (!gate.ok) return gate;

  const numRaw = formData.get('value_num');
  const textRaw = formData.get('value_text');
  const parsed = coreKpiSchema.safeParse({
    entity_id: formData.get('entity_id'),
    kpi_key: formData.get('kpi_key'),
    value_num: numRaw === '' || numRaw == null ? null : numRaw,
    value_text: textRaw === '' || textRaw == null ? null : textRaw,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  try {
    const denied = await assertEntityAccess(
      gate.profile.role,
      gate.profile.entity_id,
      parsed.data.entity_id,
    );
    if (denied) return denied;

    await patchEntityMonthKpi(
      parsed.data.entity_id,
      parsed.data.kpi_key,
      {
        value_num: parsed.data.value_num ?? null,
        value_text: emptyToNull(parsed.data.value_text ?? undefined),
      },
      {
        actorId: gate.profile.id,
        actorEmail: gate.profile.email ?? null,
      },
    );
    revalidateMaster(parsed.data.entity_id);
    return { ok: true, message: `CORE KPI ${parsed.data.kpi_key} saved` };
  } catch (e) {
    captureException(e, { action: 'updateCoreKpiAction' });
    return { ok: false, error: e instanceof Error ? e.message : 'Save failed' };
  }
}

export async function updateFlexKpiAction(
  _prev: MasterDataActionResult | null,
  formData: FormData,
): Promise<MasterDataActionResult> {
  const gate = await guardPermission('write:portfolio_health');
  if (!gate.ok) return gate;

  const numRaw = formData.get('value_num');
  const textRaw = formData.get('value_text');
  const parsed = flexKpiSchema.safeParse({
    entity_id: formData.get('entity_id'),
    flex_key: formData.get('flex_key'),
    value_num: numRaw === '' || numRaw == null ? null : numRaw,
    value_text: textRaw === '' || textRaw == null ? null : textRaw,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  try {
    const denied = await assertEntityAccess(
      gate.profile.role,
      gate.profile.entity_id,
      parsed.data.entity_id,
    );
    if (denied) return denied;

    await patchEntityMonthKpiFlex(
      parsed.data.entity_id,
      parsed.data.flex_key,
      {
        value_num: parsed.data.value_num ?? null,
        value_text: emptyToNull(parsed.data.value_text ?? undefined),
      },
      {
        actorId: gate.profile.id,
        actorEmail: gate.profile.email ?? null,
      },
    );
    revalidateMaster(parsed.data.entity_id);
    return { ok: true, message: `FLEX KPI ${parsed.data.flex_key} saved` };
  } catch (e) {
    captureException(e, { action: 'updateFlexKpiAction' });
    return { ok: false, error: e instanceof Error ? e.message : 'Save failed' };
  }
}

export type PortfolioCadencePhase60ActionResult =
  | {
      ok: true;
      report: PortfolioOperatingCadencePhase60Report;
      summary?: Record<string, unknown>;
      contract_version: typeof PHASE60_PORTFOLIO_CONTRACT_VERSION;
    }
  | {
      ok: false;
      error: string;
      report: PortfolioOperatingCadencePhase60Report;
      contract_version: typeof PHASE60_PORTFOLIO_CONTRACT_VERSION;
    };

export async function refreshPortfolioOperatingCadencePhase60Action(
  entityId?: string | null,
): Promise<PortfolioCadencePhase60ActionResult> {
  const gate = await guardPermission('write:portfolio_health');
  if (!gate.ok) {
    return {
      ok: false,
      error: gate.error,
      report: await getPortfolioOperatingCadencePhase60Report({
        entityId: entityId ?? null,
      }),
      contract_version: PHASE60_PORTFOLIO_CONTRACT_VERSION,
    };
  }

  const result = await refreshPortfolioOperatingCadencePhase60({
    actorId: gate.profile.id,
    entityId: entityId ?? null,
  });
  revalidatePath('/portfolio');
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      report: result.report,
      contract_version: PHASE60_PORTFOLIO_CONTRACT_VERSION,
    };
  }
  return {
    ok: true,
    report: result.report,
    summary: result.summary,
    contract_version: PHASE60_PORTFOLIO_CONTRACT_VERSION,
  };
}

export async function recordPortfolioRiskMilestonePhase60Action(input: {
  entityId?: string | null;
  portfolioId?: string | null;
  eventKind: string;
  title: string;
  status?: string;
  severity?: string;
}): Promise<PortfolioCadencePhase60ActionResult> {
  const gate = await guardPermission('write:portfolio_health');
  const entityId = input.entityId ?? null;
  if (!gate.ok) {
    return {
      ok: false,
      error: gate.error,
      report: await getPortfolioOperatingCadencePhase60Report({ entityId }),
      contract_version: PHASE60_PORTFOLIO_CONTRACT_VERSION,
    };
  }

  const recorded = await recordPortfolioRiskMilestonePhase60({
    ...input,
    actorId: gate.profile.id,
  });
  if (!recorded.ok) {
    return {
      ok: false,
      error: recorded.error,
      report: await getPortfolioOperatingCadencePhase60Report({ entityId }),
      contract_version: PHASE60_PORTFOLIO_CONTRACT_VERSION,
    };
  }
  revalidatePath('/portfolio');
  return {
    ok: true,
    report: await getPortfolioOperatingCadencePhase60Report({ entityId }),
    summary: recorded.data,
    contract_version: PHASE60_PORTFOLIO_CONTRACT_VERSION,
  };
}

export async function recordPortfolioReviewPacketPhase60Action(input: {
  entityId?: string | null;
  portfolioId?: string | null;
  packetKind: string;
  title: string;
  periodKey?: string;
  completenessStatus?: string;
}): Promise<PortfolioCadencePhase60ActionResult> {
  const gate = await guardPermission('write:portfolio_health');
  const entityId = input.entityId ?? null;
  if (!gate.ok) {
    return {
      ok: false,
      error: gate.error,
      report: await getPortfolioOperatingCadencePhase60Report({ entityId }),
      contract_version: PHASE60_PORTFOLIO_CONTRACT_VERSION,
    };
  }

  const recorded = await recordPortfolioReviewPacketPhase60({
    ...input,
    actorId: gate.profile.id,
  });
  if (!recorded.ok) {
    return {
      ok: false,
      error: recorded.error,
      report: await getPortfolioOperatingCadencePhase60Report({ entityId }),
      contract_version: PHASE60_PORTFOLIO_CONTRACT_VERSION,
    };
  }
  revalidatePath('/portfolio');
  return {
    ok: true,
    report: await getPortfolioOperatingCadencePhase60Report({ entityId }),
    summary: recorded.data,
    contract_version: PHASE60_PORTFOLIO_CONTRACT_VERSION,
  };
}

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  ensureMasterData,
  patchEntity,
  patchPortfolioCompany,
  patchPortfolioCoreFinancials,
} from '@/lib/data/master-data';
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

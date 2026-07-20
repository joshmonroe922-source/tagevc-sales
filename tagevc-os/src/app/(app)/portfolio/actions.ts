'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { patchEntity, patchPortfolioCompany } from '@/lib/data/master-data';
import { guardPermission } from '@/lib/rbac/session';
import { ENTITY_STATUSES, PORTFOLIO_HEALTH } from '@/lib/types';

export type MasterDataActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

const portfolioSchema = z.object({
  portfolio_id: z.string().min(1),
  health: z.enum(PORTFOLIO_HEALTH),
  top_risk: z.string().optional(),
  next_milestone: z.string().optional(),
  notes: z.string().optional(),
  coo_owner: z.string().optional(),
});

const entitySchema = z.object({
  entity_id: z.string().min(1),
  notes: z.string().optional(),
  coo_owner: z.string().optional(),
  board_lead: z.string().optional(),
  status: z.enum(ENTITY_STATUSES).optional(),
});

function emptyToNull(value: string | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function revalidateMaster(entityId: string, portfolioId?: string | null) {
  revalidatePath('/portfolio');
  revalidatePath('/entities');
  revalidatePath('/command-center');
  revalidatePath(`/entities/${entityId}`);
  if (portfolioId) revalidatePath(`/portfolio/${portfolioId}`);
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
    const entity = await patchEntity(parsed.data.entity_id, {
      notes: emptyToNull(parsed.data.notes),
      coo_owner: emptyToNull(parsed.data.coo_owner),
      board_lead: emptyToNull(parsed.data.board_lead),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
    });
    revalidateMaster(entity.entity_id, entity.portfolio_id);
    return { ok: true, message: 'Entity Master saved' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Save failed' };
  }
}

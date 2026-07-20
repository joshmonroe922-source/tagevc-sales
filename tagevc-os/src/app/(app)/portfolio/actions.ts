'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  ensureMasterData,
  patchEntity,
  patchPortfolioCompany,
} from '@/lib/data/master-data';
import {
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
    const master = await ensureMasterData();
    const existing = master.companies.find(
      (c) => c.portfolio_id === parsed.data.portfolio_id,
    );
    if (!existing) {
      return { ok: false, error: 'Unknown portfolio company' };
    }
    if (
      !canAccessEntityId(
        gate.profile.role,
        gate.profile.entity_id,
        existing.entity_id,
      )
    ) {
      return {
        ok: false,
        error: entityScopeDeniedMessage(existing.entity_id),
      };
    }

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
    if (
      !canAccessEntityId(
        gate.profile.role,
        gate.profile.entity_id,
        parsed.data.entity_id,
      )
    ) {
      return {
        ok: false,
        error: entityScopeDeniedMessage(parsed.data.entity_id),
      };
    }

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

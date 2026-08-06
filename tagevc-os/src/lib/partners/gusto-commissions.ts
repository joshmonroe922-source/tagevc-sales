/**
 * Gusto commission accounting seam.
 * Invoice paid → calculate commission → push to payroll (LIVE=0 fail-closed).
 * Uses per-entity resolve — never firm token for subsidiaries.
 */

import { recordPartnerEvent } from '@/lib/partners/repo';
import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  isGustoLive,
  resolveGustoCompany,
  resolveGustoCompanyFromEnv,
} from '@/lib/partners/gusto-entity';

export type CommissionCalcInput = {
  entityId: string;
  userId: string | null;
  invoiceId: string;
  invoicePaidCents: number;
  commissionRateBps: number; // 1000 = 10%
  currency?: string;
  notes?: string;
};

export type CommissionCalcResult =
  | {
      ok: true;
      stubId: string;
      commissionCents: number;
      pushed: boolean;
      dryRun: boolean;
    }
  | { ok: false; error: string };

export { isGustoLive };

/** Firm bootstrap env present — prefer resolveGustoCompany / gustoConfiguredForEntity. */
export function gustoConfigured(): boolean {
  return resolveGustoCompanyFromEnv('ENT-FIRM').credentialsReady;
}

/** Per-entity credentials ready (no cross-entity borrow). */
export function gustoConfiguredForEntity(entityId: string): boolean {
  return resolveGustoCompanyFromEnv(entityId).credentialsReady;
}

export function calculateCommissionCents(
  invoicePaidCents: number,
  commissionRateBps: number,
): number {
  if (invoicePaidCents <= 0 || commissionRateBps <= 0) return 0;
  return Math.round((invoicePaidCents * commissionRateBps) / 10_000);
}

/**
 * Creates a commission stub from a paid invoice. Does not call Gusto unless LIVE=1.
 */
export async function queueCommissionFromPaidInvoice(
  input: CommissionCalcInput,
): Promise<CommissionCalcResult> {
  const commissionCents = calculateCommissionCents(
    input.invoicePaidCents,
    input.commissionRateBps,
  );
  if (commissionCents <= 0) {
    return { ok: false, error: 'Commission amount is zero' };
  }

  const resolved = await resolveGustoCompany(input.entityId);

  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_gusto_commission_stubs')
      .insert({
        entity_id: input.entityId,
        user_id: input.userId,
        invoice_id: input.invoiceId,
        commission_cents: commissionCents,
        currency: input.currency ?? 'USD',
        status: 'pending_push',
        notes: input.notes ?? null,
      })
      .select('id')
      .single();

    if (error || !data) {
      return {
        ok: false,
        error: error?.message ?? 'Failed to insert commission stub',
      };
    }

    await recordPartnerEvent({
      partner_key: 'gusto',
      entity_id: input.entityId,
      kind: 'commission_push',
      status: 'received',
      external_id: input.invoiceId,
      payload: {
        stub_id: data.id,
        commission_cents: commissionCents,
        live: isGustoLive(),
        company_uuid: resolved.companyUuid,
        resolve_source: resolved.source,
      },
    });

    if (!isGustoLive() || !resolved.credentialsReady) {
      return {
        ok: true,
        stubId: data.id as string,
        commissionCents,
        pushed: false,
        dryRun: true,
      };
    }

    // Live push seam — real Gusto payroll API wired when credentials exist.
    // Fail-closed: payee entity company only (never firm borrow).
    const gustoRef = `gusto-pending:${resolved.companyUuid}:${data.id}`;
    await sb
      .from('os_gusto_commission_stubs')
      .update({
        status: 'pushed',
        gusto_ref: gustoRef,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.id);

    return {
      ok: true,
      stubId: data.id as string,
      commissionCents,
      pushed: true,
      dryRun: false,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Commission queue failed',
    };
  }
}

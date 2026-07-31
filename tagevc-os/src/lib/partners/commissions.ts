/**
 * Partner commission accounting stubs (Gusto path).
 * When invoices are paid → calculate commissions → queue payroll push.
 */

export type CommissionQueueItem = {
  id: string;
  entity_id: string;
  invoice_id: string;
  user_profile_id: string | null;
  user_external_id: string | null;
  amount_cents: number;
  currency: string;
  status: 'queued' | 'pushed_stub' | 'failed' | 'cancelled';
  source: 'invoice_paid';
  created_at: string;
};

/** Pure calc helper — rate points from deal metadata (scaffold). */
export function calculateCommissionCents(input: {
  invoiceAmountCents: number;
  rateBps: number;
}): number {
  if (input.invoiceAmountCents <= 0 || input.rateBps <= 0) return 0;
  return Math.round((input.invoiceAmountCents * input.rateBps) / 10_000);
}

export function buildCommissionQueueStub(input: {
  entityId: string;
  invoiceId: string;
  userProfileId?: string | null;
  userExternalId?: string | null;
  invoiceAmountCents: number;
  rateBps: number;
}): CommissionQueueItem {
  return {
    id: `comm-stub:${input.invoiceId}`,
    entity_id: input.entityId,
    invoice_id: input.invoiceId,
    user_profile_id: input.userProfileId ?? null,
    user_external_id: input.userExternalId ?? null,
    amount_cents: calculateCommissionCents({
      invoiceAmountCents: input.invoiceAmountCents,
      rateBps: input.rateBps,
    }),
    currency: 'USD',
    status: 'queued',
    source: 'invoice_paid',
    created_at: new Date().toISOString(),
  };
}

'use server';

import { revalidatePath } from 'next/cache';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import type { PartnerKey } from '@/lib/partners/catalog';
import {
  upsertVendorContract,
  upsertVendorPayment,
} from '@/lib/partners/repo';

export type PartnerWriteResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

async function requireFirmWrite() {
  await requirePermission('write:it_assets');
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false as const, error: 'Not signed in' };
  if (!isFirmWideAccess(ctx.profile.role, ctx.profile.entity_id)) {
    return { ok: false as const, error: 'Firm-wide access required to write contracts' };
  }
  return { ok: true as const, ctx };
}

export async function savePartnerContractAction(
  formData: FormData,
): Promise<PartnerWriteResult> {
  const gate = await requireFirmWrite();
  if (!gate.ok) return gate;

  const partner_key = String(formData.get('partner_key') || '') as PartnerKey;
  const vendor_name = String(formData.get('vendor_name') || '').trim();
  const contract_title = String(formData.get('contract_title') || '').trim();
  if (!partner_key || !vendor_name || !contract_title) {
    return { ok: false, error: 'Partner, vendor name, and title are required' };
  }

  const amountRaw = formData.get('amount');
  const amount =
    amountRaw === '' || amountRaw == null ? null : Number(amountRaw);
  const amount_cents =
    amount == null || Number.isNaN(amount) ? null : Math.round(amount * 100);

  const row = await upsertVendorContract({
    id: String(formData.get('id') || '') || undefined,
    partner_key,
    entity_id: String(formData.get('entity_id') || '') || null,
    vendor_name,
    contract_title,
    status: (String(formData.get('status') || 'active') as
      | 'draft'
      | 'active'
      | 'expired'
      | 'cancelled'
      | 'renewal_due') || 'active',
    starts_on: String(formData.get('starts_on') || '') || null,
    ends_on: String(formData.get('ends_on') || '') || null,
    amount_cents,
    currency: String(formData.get('currency') || 'USD'),
    payment_cadence: String(formData.get('payment_cadence') || '') || null,
    document_path: String(formData.get('document_path') || '') || null,
    notes: String(formData.get('notes') || '') || null,
  });

  if (!row) return { ok: false, error: 'Save failed — is phase89 SQL applied?' };
  revalidatePath('/shared-services/it/technology-stack');
  return { ok: true, id: row.id };
}

export async function savePartnerPaymentAction(
  formData: FormData,
): Promise<PartnerWriteResult> {
  const gate = await requireFirmWrite();
  if (!gate.ok) return gate;

  const contract_id = String(formData.get('contract_id') || '');
  const paid_on = String(formData.get('paid_on') || '');
  const amount = Number(formData.get('amount') || 0);
  if (!contract_id || !paid_on || !amount) {
    return { ok: false, error: 'Contract, date, and amount required' };
  }

  const row = await upsertVendorPayment({
    contract_id,
    paid_on,
    amount_cents: Math.round(amount * 100),
    currency: String(formData.get('currency') || 'USD'),
    reference: String(formData.get('reference') || '') || null,
    notes: String(formData.get('notes') || '') || null,
  });
  if (!row) return { ok: false, error: 'Payment save failed' };
  revalidatePath('/shared-services/it/technology-stack');
  return { ok: true, id: row.id };
}

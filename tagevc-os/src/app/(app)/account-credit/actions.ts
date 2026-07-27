'use server';

import { revalidatePath } from 'next/cache';

import {
  completeAccountCreditFromUpload,
  listAccountCreditChecks,
  listRecentAccountCreditChecks,
  requestAccountCreditCheck,
  saveAccountCreditManual,
  waiveAccountCreditCheck,
} from '@/lib/account-credit/repo';
import type { AccountCreditBureau, AccountCreditRefType } from '@/lib/account-credit/types';
import { canRunAccountCreditCheck } from '@/lib/account-credit/types';
import { getSessionContext } from '@/lib/rbac/session';

export type AccountCreditActionResult =
  | { ok: true; message?: string; checkId?: string }
  | { ok: false; error: string };

async function requireRunner() {
  const session = await getSessionContext();
  if (!session) return { ok: false as const, error: 'Not authenticated.' };
  if (!canRunAccountCreditCheck(session.profile.role)) {
    return {
      ok: false as const,
      error: 'Manager or finance role required to run credit checks.',
    };
  }
  return { ok: true as const, session };
}

export async function requestAccountCreditCheckAction(
  formData: FormData,
): Promise<AccountCreditActionResult> {
  const gate = await requireRunner();
  if (!gate.ok) return { ok: false, error: gate.error };
  const entityId = String(formData.get('entity_id') ?? '').trim();
  const accountRefType = String(
    formData.get('account_ref_type') ?? '',
  ).trim() as AccountCreditRefType;
  const accountRefId = String(formData.get('account_ref_id') ?? '').trim();
  const displayName = String(formData.get('account_display_name') ?? '').trim();
  if (!entityId || !accountRefType || !accountRefId || !displayName) {
    return { ok: false, error: 'Missing account binding fields.' };
  }
  const { check, error } = await requestAccountCreditCheck({
    entityId,
    accountRefType,
    accountRefId,
    accountDisplayName: displayName,
    accountIdentifiers: {
      account_id: String(formData.get('account_business_id') ?? '').trim() || null,
    },
    actorId: gate.session.profile.id,
  });
  if (error || !check) return { ok: false, error: error ?? 'Request failed.' };
  revalidatePath('/shared-services/finance');
  return { ok: true, message: 'Credit check requested.', checkId: check.id };
}

export async function uploadAccountCreditReportAction(
  formData: FormData,
): Promise<AccountCreditActionResult> {
  const gate = await requireRunner();
  if (!gate.ok) return { ok: false, error: gate.error };

  const checkId = String(formData.get('check_id') ?? '').trim();
  const entityId = String(formData.get('entity_id') ?? '').trim();
  const bureau = String(formData.get('bureau') ?? 'dnb').trim() as AccountCreditBureau;
  const pasteText = String(formData.get('paste_text') ?? '').trim() || null;
  const file = formData.get('file');
  if (!checkId || !entityId) return { ok: false, error: 'Missing check id.' };
  if (!(file instanceof File) || file.size === 0) {
    if (!pasteText) return { ok: false, error: 'Upload a PDF/export or paste text.' };
  }

  let bytes = Buffer.alloc(0);
  let fileName = 'paste.txt';
  let mimeType = 'text/plain';
  if (file instanceof File && file.size > 0) {
    bytes = Buffer.from(await file.arrayBuffer());
    fileName = file.name;
    mimeType = file.type || 'application/octet-stream';
  } else if (pasteText) {
    bytes = Buffer.from(pasteText, 'utf8');
  }

  const { check, error } = await completeAccountCreditFromUpload({
    checkId,
    entityId,
    bureau,
    fileName,
    mimeType,
    bytes,
    pasteText,
    actorId: gate.session.profile.id,
  });
  if (error || !check) return { ok: false, error: error ?? 'Upload failed.' };
  revalidatePath('/shared-services/finance');
  return {
    ok: true,
    message: `Check ${check.status} · risk ${check.risk_band ?? 'n/a'} · suggest ${check.suggested_terms ?? 'n/a'}`,
    checkId: check.id,
  };
}

export async function waiveAccountCreditCheckAction(
  formData: FormData,
): Promise<AccountCreditActionResult> {
  const gate = await requireRunner();
  if (!gate.ok) return { ok: false, error: gate.error };
  const checkId = String(formData.get('check_id') ?? '').trim();
  const entityId = String(formData.get('entity_id') ?? '').trim();
  const reason = String(formData.get('waiver_reason') ?? '');
  const { check, error } = await waiveAccountCreditCheck({
    checkId,
    entityId,
    reason,
    actorId: gate.session.profile.id,
  });
  if (error || !check) return { ok: false, error: error ?? 'Waiver failed.' };
  revalidatePath('/shared-services/finance');
  return { ok: true, message: 'Check waived — DUR remains default.' };
}

export async function saveAccountCreditManualAction(
  formData: FormData,
): Promise<AccountCreditActionResult> {
  const gate = await requireRunner();
  if (!gate.ok) return { ok: false, error: gate.error };
  const checkId = String(formData.get('check_id') ?? '').trim();
  const entityId = String(formData.get('entity_id') ?? '').trim();
  const scores: Record<string, unknown> = {};
  for (const key of [
    'paydex',
    'intelliscore_plus',
    'business_credit_risk',
    'payment_index',
  ]) {
    const raw = String(formData.get(key) ?? '').trim();
    if (raw) scores[key] = Number(raw);
  }
  const { check, error } = await saveAccountCreditManual({
    checkId,
    entityId,
    scores,
    actorId: gate.session.profile.id,
  });
  if (error || !check) return { ok: false, error: error ?? 'Save failed.' };
  revalidatePath('/shared-services/finance');
  return { ok: true, message: 'Manual scores saved.', checkId: check.id };
}

export async function loadAccountCreditChecksAction(input: {
  entityId: string;
  accountRefType: AccountCreditRefType;
  accountRefId: string;
}) {
  return listAccountCreditChecks(input);
}

export async function loadRecentAccountCreditChecksAction(entityId?: string | null) {
  return listRecentAccountCreditChecks({ entityId, limit: 30 });
}

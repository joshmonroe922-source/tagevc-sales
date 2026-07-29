'use server';

import { revalidatePath } from 'next/cache';
import {
  createInvestorAsset,
  deleteInvestorAsset,
  parseAssetCsv,
  updateInvestorAsset,
  type CreateInvestorAssetInput,
} from '@/lib/net-worth/assets';
import {
  addPersonalCreditItem,
  setPersonalCreditActionStatus,
  updatePersonalCreditScores,
  upsertBusinessCreditProfile,
} from '@/lib/net-worth/credit';
import {
  canAccessCreditManagement,
  canAccessNetWorthPage,
  canViewBusinessCredit,
  canViewPersonalCredit,
  type InvestorAssetClass,
} from '@/lib/net-worth/visibility';
import { getSessionContext } from '@/lib/rbac/session';

function revalidateNw() {
  revalidatePath('/portfolio/net-worth');
  revalidatePath('/portfolio/net-worth/credit');
  revalidatePath('/portfolio/investments');
  revalidatePath('/firm');
  revalidatePath('/dashboard');
}

export type NwActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

async function requireVisionaryNetWorth(): Promise<
  { ok: true; profileId: string } | { ok: false; error: string }
> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: 'Not signed in' };
  if (
    !canAccessNetWorthPage({
      realRole: ctx.realRole,
      liveLookActive: ctx.liveLookActive,
    })
  ) {
    return { ok: false, error: 'Visionary-only · blocked during Live Look' };
  }
  return { ok: true, profileId: ctx.profile.id };
}

async function requireCreditManagement(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: 'Not signed in' };
  if (
    !canAccessCreditManagement({
      role: ctx.profile.role,
      realRole: ctx.realRole,
      liveLookActive: ctx.liveLookActive,
    })
  ) {
    return {
      ok: false,
      error: 'Credit Management is not available for Think Tank',
    };
  }
  return { ok: true };
}

export async function createNetWorthAssetAction(
  formData: FormData,
): Promise<NwActionResult> {
  const gate = await requireVisionaryNetWorth();
  if (!gate.ok) return gate;

  const input: CreateInvestorAssetInput = {
    name: String(formData.get('name') ?? '').trim(),
    institution: String(formData.get('institution') ?? '').trim(),
    asset_class: String(
      formData.get('asset_class') ?? 'brokerage',
    ).trim() as InvestorAssetClass,
    balance: Number(formData.get('balance') ?? 0),
    currency: String(formData.get('currency') ?? 'USD').trim() || 'USD',
    entity_id: String(formData.get('entity_id') ?? '').trim() || null,
    notes: String(formData.get('notes') ?? '').trim(),
    source: 'manual',
    created_by: gate.profileId,
  };
  if (input.name.length < 2) return { ok: false, error: 'Name required' };
  if (Number.isNaN(input.balance)) return { ok: false, error: 'Invalid balance' };

  const res = await createInvestorAsset(input);
  if (!res.ok) return { ok: false, error: res.error };
  revalidateNw();
  return { ok: true, message: `Added ${res.asset.name}` };
}

export async function importNetWorthCsvAction(
  csvText: string,
): Promise<NwActionResult> {
  const gate = await requireVisionaryNetWorth();
  if (!gate.ok) return gate;
  const rows = parseAssetCsv(csvText);
  if (rows.length === 0) {
    return { ok: false, error: 'No valid CSV rows (name,institution,asset_class,balance)' };
  }
  let ok = 0;
  let fail = 0;
  for (const row of rows) {
    const res = await createInvestorAsset({
      ...row,
      created_by: gate.profileId,
    });
    if (res.ok) ok += 1;
    else fail += 1;
  }
  revalidateNw();
  return {
    ok: true,
    message: `CSV import: ${ok} added${fail ? `, ${fail} failed` : ''}`,
  };
}

export async function deleteNetWorthAssetAction(
  assetId: string,
): Promise<NwActionResult> {
  const gate = await requireVisionaryNetWorth();
  if (!gate.ok) return gate;
  const res = await deleteInvestorAsset(assetId);
  if (!res.ok) return { ok: false, error: res.error };
  revalidateNw();
  return { ok: true, message: 'Asset removed' };
}

export async function updateNetWorthAssetBalanceAction(input: {
  assetId: string;
  balance: number;
}): Promise<NwActionResult> {
  const gate = await requireVisionaryNetWorth();
  if (!gate.ok) return gate;
  const res = await updateInvestorAsset(input.assetId, {
    balance: input.balance,
    as_of: new Date().toISOString(),
    updated_by: gate.profileId,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateNw();
  return { ok: true, message: 'Balance updated' };
}

export async function updatePersonalCreditAction(
  formData: FormData,
): Promise<NwActionResult> {
  const creditGate = await requireCreditManagement();
  if (!creditGate.ok) return creditGate;
  const ctx = await getSessionContext();
  if (
    !ctx ||
    !canViewPersonalCredit({
      realRole: ctx.realRole,
      liveLookActive: ctx.liveLookActive,
    })
  ) {
    return { ok: false, error: 'Visionary-only · blocked during Live Look' };
  }
  const profileId = String(formData.get('profile_id') ?? '');
  const num = (k: string) => {
    const v = String(formData.get(k) ?? '').trim();
    return v ? Number(v) : null;
  };
  const res = await updatePersonalCreditScores({
    profileId,
    experian_score: num('experian_score'),
    equifax_score: num('equifax_score'),
    transunion_score: num('transunion_score'),
    score_as_of: String(formData.get('score_as_of') ?? '').trim() || null,
    notes: String(formData.get('notes') ?? '').trim(),
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateNw();
  return { ok: true, message: 'Personal credit saved' };
}

export async function addPersonalCreditItemAction(
  formData: FormData,
): Promise<NwActionResult> {
  const creditGate = await requireCreditManagement();
  if (!creditGate.ok) return creditGate;
  const ctx = await getSessionContext();
  if (
    !ctx ||
    !canViewPersonalCredit({
      realRole: ctx.realRole,
      liveLookActive: ctx.liveLookActive,
    })
  ) {
    return { ok: false, error: 'Visionary-only' };
  }
  const res = await addPersonalCreditItem({
    profileId: String(formData.get('profile_id') ?? ''),
    kind: String(formData.get('kind') ?? 'open_item') as
      | 'open_item'
      | 'negative'
      | 'dispute'
      | 'inquiry'
      | 'other',
    title: String(formData.get('title') ?? '').trim(),
    bureau: (String(formData.get('bureau') ?? '').trim() ||
      null) as 'experian' | 'equifax' | 'transunion' | 'other' | null,
    amount: (() => {
      const v = String(formData.get('amount') ?? '').trim();
      return v ? Number(v) : null;
    })(),
    notes: String(formData.get('notes') ?? '').trim(),
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateNw();
  return { ok: true, message: 'Item added' };
}

export async function setPersonalActionStatusAction(input: {
  actionId: string;
  status: 'todo' | 'doing' | 'done' | 'skipped';
}): Promise<NwActionResult> {
  const creditGate = await requireCreditManagement();
  if (!creditGate.ok) return creditGate;
  const ctx = await getSessionContext();
  if (
    !ctx ||
    !canViewPersonalCredit({
      realRole: ctx.realRole,
      liveLookActive: ctx.liveLookActive,
    })
  ) {
    return { ok: false, error: 'Visionary-only' };
  }
  const res = await setPersonalCreditActionStatus(input);
  if (!res.ok) return { ok: false, error: res.error };
  revalidateNw();
  return { ok: true, message: 'Action updated' };
}

export async function upsertBusinessCreditAction(
  formData: FormData,
): Promise<NwActionResult> {
  const creditGate = await requireCreditManagement();
  if (!creditGate.ok) return creditGate;
  const ctx = await getSessionContext();
  if (!ctx || !canViewBusinessCredit(ctx.profile.role)) {
    return { ok: false, error: 'Business credit requires finance/SSC/Visionary' };
  }
  if (ctx.liveLookActive) {
    return { ok: false, error: 'Writes blocked during Live Look' };
  }
  const res = await upsertBusinessCreditProfile({
    entity_id: String(formData.get('entity_id') ?? '').trim(),
    duns_number: String(formData.get('duns_number') ?? '').trim() || null,
    duns_status: String(
      formData.get('duns_status') ?? 'unknown',
    ).trim() as
      | 'unknown'
      | 'not_started'
      | 'pending'
      | 'active'
      | 'stale'
      | 'issue',
    dn_b_score: String(formData.get('dn_b_score') ?? '').trim() || null,
    experian_biz_score:
      String(formData.get('experian_biz_score') ?? '').trim() || null,
    equifax_biz_score:
      String(formData.get('equifax_biz_score') ?? '').trim() || null,
    report_as_of: String(formData.get('report_as_of') ?? '').trim() || null,
    monitoring_cadence: String(
      formData.get('monitoring_cadence') ?? 'quarterly',
    ).trim() as 'monthly' | 'quarterly' | 'annual',
    next_review_at: String(formData.get('next_review_at') ?? '').trim() || null,
    negative_notes: String(formData.get('negative_notes') ?? '').trim(),
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateNw();
  revalidatePath(`/entities/${String(formData.get('entity_id') ?? '')}`);
  return { ok: true, message: 'Business credit saved' };
}

async function requireBusinessCredit(): Promise<
  { ok: true; profileId: string } | { ok: false; error: string }
> {
  const creditGate = await requireCreditManagement();
  if (!creditGate.ok) return creditGate;
  const ctx = await getSessionContext();
  if (!ctx || !canViewBusinessCredit(ctx.profile.role)) {
    return { ok: false, error: 'Business credit requires finance/SSC/Visionary' };
  }
  if (ctx.liveLookActive) {
    return { ok: false, error: 'Writes blocked during Live Look' };
  }
  return { ok: true, profileId: ctx.profile.id };
}

export async function importBusinessCreditReportAction(input: {
  entityId: string;
  bureau: 'dnb' | 'experian_business' | 'equifax_business';
  fileName: string;
  mimeType: string;
  base64: string;
  pasteText?: string;
}): Promise<
  | { ok: true; message: string; parse_status: string }
  | { ok: false; error: string }
> {
  const gate = await requireBusinessCredit();
  if (!gate.ok) return gate;
  const bytes = Buffer.from(input.base64, 'base64');
  if (bytes.byteLength > 20 * 1024 * 1024) {
    return { ok: false, error: 'File too large (20MB max)' };
  }
  const { importBusinessCreditReport } = await import(
    '@/lib/net-worth/business-credit-bureaus'
  );
  const res = await importBusinessCreditReport({
    entityId: input.entityId,
    bureau: input.bureau,
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes,
    actorId: gate.profileId,
    pasteText: input.pasteText,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateNw();
  const { label, value } = (
    await import('@/lib/net-worth/business-credit-types')
  ).primaryBusinessScore(input.bureau, res.snapshot.scores);
  return {
    ok: true,
    message: `Imported · ${label}=${value ?? 'n/a'} (${res.snapshot.parse_status})`,
    parse_status: res.snapshot.parse_status,
  };
}

export async function saveBusinessBureauManualAction(input: {
  entityId: string;
  bureau: 'dnb' | 'experian_business' | 'equifax_business';
  identifier: string;
  primaryScore: string;
  secondaryScore: string;
  reportDate: string;
}): Promise<NwActionResult> {
  const gate = await requireBusinessCredit();
  if (!gate.ok) return gate;

  const num = (s: string): number | null => {
    const n = Number(s.trim());
    return s.trim() && !Number.isNaN(n) ? n : null;
  };
  const identifiers: Record<string, string | null> = {};
  const scores: Record<string, number | null> = {};
  const id = input.identifier.trim() || null;
  if (input.bureau === 'dnb') {
    identifiers.duns = id;
    scores.paydex = num(input.primaryScore);
    scores.failure_score = num(input.secondaryScore);
  } else if (input.bureau === 'experian_business') {
    identifiers.experian_file_number = id;
    scores.intelliscore_plus = num(input.primaryScore);
    scores.financial_stability_risk = num(input.secondaryScore);
  } else {
    identifiers.equifax_id = id;
    scores.business_credit_risk = num(input.primaryScore);
    scores.business_failure_score = num(input.secondaryScore);
  }

  const { saveBusinessBureauManual } = await import(
    '@/lib/net-worth/business-credit-bureaus'
  );
  const res = await saveBusinessBureauManual({
    entityId: input.entityId,
    bureau: input.bureau,
    identifiers,
    scores,
    reportDate: input.reportDate.trim() || null,
    actorId: gate.profileId,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateNw();
  return { ok: true, message: 'Manual bureau entry saved' };
}

export async function importPersonalCreditReportAction(input: {
  subjectId: string;
  displayName: string;
  source: 'myfico' | 'experian' | 'equifax' | 'annualcreditreport' | 'other' | 'manual_upload';
  fileName: string;
  mimeType: string;
  base64: string;
  pasteText?: string;
}): Promise<
  | {
      ok: true;
      message: string;
      fico_8: number | null;
      fico_10: number | null;
      parse_status: string;
    }
  | { ok: false; error: string }
> {
  const creditGate = await requireCreditManagement();
  if (!creditGate.ok) return creditGate;
  const ctx = await getSessionContext();
  if (
    !ctx ||
    !canViewPersonalCredit({
      realRole: ctx.realRole,
      liveLookActive: ctx.liveLookActive,
    })
  ) {
    return { ok: false, error: 'Visionary-only · blocked during Live Look' };
  }
  const bytes = Buffer.from(input.base64, 'base64');
  if (bytes.byteLength > 20 * 1024 * 1024) {
    return { ok: false, error: 'File too large (20MB max)' };
  }
  const { importCreditReport } = await import('@/lib/net-worth/personal-credit');
  const res = await importCreditReport({
    subjectId: input.subjectId,
    displayName: input.displayName,
    source: input.source,
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes,
    actorId: ctx.profile.id,
    pasteText: input.pasteText,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateNw();
  return {
    ok: true,
    message: `Imported for ${input.displayName} · FICO 8=${res.snapshot.fico_8 ?? 'n/a'} · FICO 10=${res.snapshot.fico_10 ?? 'n/a'} (${res.snapshot.parse_status})`,
    fico_8: res.snapshot.fico_8,
    fico_10: res.snapshot.fico_10,
    parse_status: res.snapshot.parse_status,
  };
}

export async function sendCreditGrokAction(
  message: string,
): Promise<
  | { ok: true; reply: string }
  | { ok: false; error: string }
> {
  const creditGate = await requireCreditManagement();
  if (!creditGate.ok) return creditGate;
  const ctx = await getSessionContext();
  if (
    !ctx ||
    !canViewPersonalCredit({
      realRole: ctx.realRole,
      liveLookActive: ctx.liveLookActive,
    })
  ) {
    return { ok: false, error: 'Visionary-only · blocked during Live Look' };
  }
  const { sendCreditGrokMessage } = await import('@/lib/net-worth/credit-grok');
  const res = await sendCreditGrokMessage({
    message,
    actorId: ctx.profile.id,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateNw();
  return { ok: true, reply: res.assistant.content };
}

import { randomUUID } from 'node:crypto';

import {
  mergeBureauBags,
  riskBandFromBureauBag,
  suggestTermsFromRisk,
} from '@/lib/account-credit/rules';
import type {
  AccountCreditBureau,
  AccountCreditCheck,
  AccountCreditRefType,
  AccountCreditStatus,
} from '@/lib/account-credit/types';
import {
  parseBusinessCreditReportText,
  extractTextFromPdfBuffer,
} from '@/lib/net-worth/business-credit-parse';
import { createClient } from '@/lib/supabase/server';

const BUCKET = 'credit-private';

function mapRow(row: Record<string, unknown>): AccountCreditCheck {
  return {
    id: String(row.id),
    entity_id: String(row.entity_id),
    account_ref_type: row.account_ref_type as AccountCreditRefType,
    account_ref_id: String(row.account_ref_id),
    account_display_name: String(row.account_display_name ?? ''),
    account_identifiers:
      (row.account_identifiers as Record<string, unknown>) ?? {},
    status: row.status as AccountCreditStatus,
    bureaus_requested: (row.bureaus_requested as AccountCreditBureau[]) ?? [],
    risk_band: (row.risk_band as AccountCreditCheck['risk_band']) ?? null,
    scores: (row.scores as Record<string, unknown>) ?? {},
    summary: (row.summary as Record<string, unknown>) ?? {},
    suggested_terms:
      (row.suggested_terms as AccountCreditCheck['suggested_terms']) ?? null,
    suggested_credit_limit:
      row.suggested_credit_limit != null
        ? Number(row.suggested_credit_limit)
        : null,
    recommendation_notes: String(row.recommendation_notes ?? ''),
    raw_storage_paths:
      (row.raw_storage_paths as Record<string, string>) ?? {},
    source: (row.source as AccountCreditCheck['source']) ?? 'guided_export',
    requested_by: (row.requested_by as string | null) ?? null,
    requested_at: String(row.requested_at),
    completed_at: (row.completed_at as string | null) ?? null,
    waiver_reason: (row.waiver_reason as string | null) ?? null,
    waived_by: (row.waived_by as string | null) ?? null,
    waived_at: (row.waived_at as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function listAccountCreditChecks(input: {
  entityId: string;
  accountRefType: AccountCreditRefType;
  accountRefId: string;
  limit?: number;
}): Promise<{ checks: AccountCreditCheck[]; error?: string }> {
  const sb = await createClient();
  const { data, error } = await sb
    .from('os_account_credit_checks')
    .select('*')
    .eq('entity_id', input.entityId)
    .eq('account_ref_type', input.accountRefType)
    .eq('account_ref_id', input.accountRefId)
    .order('requested_at', { ascending: false })
    .limit(input.limit ?? 20);
  if (error) return { checks: [], error: error.message };
  return {
    checks: ((data ?? []) as Record<string, unknown>[]).map(mapRow),
  };
}

export async function listRecentAccountCreditChecks(input?: {
  entityId?: string | null;
  limit?: number;
}): Promise<{ checks: AccountCreditCheck[]; error?: string }> {
  const sb = await createClient();
  let q = sb
    .from('os_account_credit_checks')
    .select('*')
    .order('requested_at', { ascending: false })
    .limit(input?.limit ?? 40);
  if (input?.entityId) q = q.eq('entity_id', input.entityId);
  const { data, error } = await q;
  if (error) return { checks: [], error: error.message };
  return {
    checks: ((data ?? []) as Record<string, unknown>[]).map(mapRow),
  };
}

export async function requestAccountCreditCheck(input: {
  entityId: string;
  accountRefType: AccountCreditRefType;
  accountRefId: string;
  accountDisplayName: string;
  accountIdentifiers?: Record<string, unknown>;
  actorId: string;
}): Promise<{ check: AccountCreditCheck | null; error?: string }> {
  const sb = await createClient();
  const { data, error } = await sb
    .from('os_account_credit_checks')
    .insert({
      entity_id: input.entityId,
      account_ref_type: input.accountRefType,
      account_ref_id: input.accountRefId,
      account_display_name: input.accountDisplayName,
      account_identifiers: input.accountIdentifiers ?? {},
      status: 'requested',
      source: 'guided_export',
      requested_by: input.actorId,
      requested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .maybeSingle();
  if (error) return { check: null, error: error.message };
  return { check: data ? mapRow(data as Record<string, unknown>) : null };
}

export async function waiveAccountCreditCheck(input: {
  checkId: string;
  entityId: string;
  reason: string;
  actorId: string;
}): Promise<{ check: AccountCreditCheck | null; error?: string }> {
  const reason = input.reason.trim();
  if (reason.length < 8) {
    return { check: null, error: 'Waiver reason required (8+ characters).' };
  }
  const sb = await createClient();
  const { data, error } = await sb
    .from('os_account_credit_checks')
    .update({
      status: 'waived',
      waiver_reason: reason,
      waived_by: input.actorId,
      waived_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      recommendation_notes:
        'Check waived — commercial posture remains Due Upon Receipt until explicitly changed.',
      suggested_terms: 'due_upon_receipt',
      risk_band: 'unknown',
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.checkId)
    .eq('entity_id', input.entityId)
    .select('*')
    .maybeSingle();
  if (error) return { check: null, error: error.message };
  return { check: data ? mapRow(data as Record<string, unknown>) : null };
}

export async function completeAccountCreditFromUpload(input: {
  checkId: string;
  entityId: string;
  bureau: AccountCreditBureau;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  pasteText?: string | null;
  actorId: string;
}): Promise<{ check: AccountCreditCheck | null; error?: string }> {
  const sb = await createClient();
  const { data: existing, error: loadErr } = await sb
    .from('os_account_credit_checks')
    .select('*')
    .eq('id', input.checkId)
    .eq('entity_id', input.entityId)
    .maybeSingle();
  if (loadErr || !existing) {
    return { check: null, error: loadErr?.message ?? 'Check not found.' };
  }

  const path = `account-credit/${input.entityId}/${input.checkId}/${input.bureau}/${Date.now()}-${randomUUID().slice(0, 8)}-${input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, input.bytes, {
    contentType: input.mimeType || 'application/octet-stream',
    upsert: false,
  });

  let text = input.pasteText?.trim() || '';
  if (!text) {
    if (
      input.mimeType.includes('pdf') ||
      input.fileName.toLowerCase().endsWith('.pdf')
    ) {
      text = extractTextFromPdfBuffer(input.bytes);
    } else {
      text = input.bytes.toString('utf8');
    }
  }

  const parse = parseBusinessCreditReportText({
    text,
    preferredBureau: input.bureau,
  });

  const prev = mapRow(existing as Record<string, unknown>);
  const scores = { ...prev.scores, ...parse.scores };
  const summary = {
    ...prev.summary,
    ...parse.summary,
    last_bureau: input.bureau,
    last_parse_status: parse.parse_status,
    last_parse_errors: parse.parse_errors,
  };
  const paths = {
    ...prev.raw_storage_paths,
    ...(upErr ? {} : { [input.bureau]: path }),
  };

  const bag = mergeBureauBags(scores, summary);
  const { risk_band, thin_file } = riskBandFromBureauBag(bag);
  const guidance = suggestTermsFromRisk(risk_band, { thinFile: thin_file });

  const status: AccountCreditStatus =
    parse.parse_status === 'failed' && !Object.keys(scores).length
      ? 'failed'
      : thin_file && risk_band === 'unknown'
        ? 'thin_file'
        : 'completed';

  const { data, error } = await sb
    .from('os_account_credit_checks')
    .update({
      status,
      scores,
      summary: { ...summary, thin_file },
      risk_band,
      suggested_terms: guidance.suggested_terms,
      recommendation_notes: guidance.notes,
      raw_storage_paths: paths,
      source: 'guided_export',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.checkId)
    .eq('entity_id', input.entityId)
    .select('*')
    .maybeSingle();

  if (error) return { check: null, error: error.message };
  return { check: data ? mapRow(data as Record<string, unknown>) : null };
}

export async function saveAccountCreditManual(input: {
  checkId: string;
  entityId: string;
  scores: Record<string, unknown>;
  summary?: Record<string, unknown>;
  actorId: string;
}): Promise<{ check: AccountCreditCheck | null; error?: string }> {
  const sb = await createClient();
  const { data: existing, error: loadErr } = await sb
    .from('os_account_credit_checks')
    .select('*')
    .eq('id', input.checkId)
    .eq('entity_id', input.entityId)
    .maybeSingle();
  if (loadErr || !existing) {
    return { check: null, error: loadErr?.message ?? 'Check not found.' };
  }
  const prev = mapRow(existing as Record<string, unknown>);
  const scores = { ...prev.scores, ...input.scores };
  const summary = { ...prev.summary, ...(input.summary ?? {}) };
  const bag = mergeBureauBags(scores, summary);
  const { risk_band, thin_file } = riskBandFromBureauBag(bag);
  const guidance = suggestTermsFromRisk(risk_band, { thinFile: thin_file });

  const { data, error } = await sb
    .from('os_account_credit_checks')
    .update({
      status: thin_file && risk_band === 'unknown' ? 'thin_file' : 'completed',
      scores,
      summary: { ...summary, thin_file },
      risk_band,
      suggested_terms: guidance.suggested_terms,
      recommendation_notes: guidance.notes,
      source: 'manual_upload',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.checkId)
    .eq('entity_id', input.entityId)
    .select('*')
    .maybeSingle();
  if (error) return { check: null, error: error.message };
  return { check: data ? mapRow(data as Record<string, unknown>) : null };
}

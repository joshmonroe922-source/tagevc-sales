/**
 * Phase 75 — Multi-bureau business credit (D&B / Experian Business /
 * Equifax Business). Guided human-gated import + manual entry only.
 * Permissions: same as Phase 73 business credit (enforced at action/RLS layer).
 */

import { randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { writeAuditEvent } from '@/lib/audit/write';
import { entityDisplayName } from '@/lib/entities/display-name';
import { daysSince, isStale } from '@/lib/net-worth/credit-parse';
import {
  extractTextFromPdfBuffer,
  parseBusinessCreditReportText,
  type BusinessParseResult,
} from '@/lib/net-worth/business-credit-parse';
import {
  BUSINESS_BUREAUS,
  BUSINESS_BUREAU_LABELS,
  primaryBusinessScore,
  type BusinessBureau,
  type BusinessBureauCompany,
  type BusinessBureauConnection,
  type BusinessBureauIdentifiers,
  type BusinessBureauScores,
  type BusinessBureauSnapshot,
} from '@/lib/net-worth/business-credit-types';

const BUCKET = 'credit-private';

export const BUSINESS_CREDIT_STALE_DAYS = Number(
  process.env.BUSINESS_CREDIT_STALE_DAYS?.trim() || '60',
);

function mapSnapshot(r: Record<string, unknown>): BusinessBureauSnapshot {
  const pulled = String(r.pulled_at);
  return {
    id: String(r.id),
    entity_id: String(r.entity_id),
    bureau: r.bureau as BusinessBureau,
    pulled_at: pulled,
    report_date: r.report_date ? String(r.report_date).slice(0, 10) : null,
    source: (r.source as BusinessBureauSnapshot['source']) ?? 'manual_upload',
    identifiers: (r.identifiers as BusinessBureauIdentifiers) ?? {},
    scores: (r.scores as BusinessBureauScores) ?? {},
    summary: (r.summary as BusinessBureauSnapshot['summary']) ?? {},
    raw_storage_path: (r.raw_storage_path as string) ?? null,
    parse_status: String(r.parse_status ?? 'pending'),
    parse_errors: String(r.parse_errors ?? ''),
    days_old: daysSince(pulled),
    stale: isStale(pulled, BUSINESS_CREDIT_STALE_DAYS),
  };
}

function mapConnection(r: Record<string, unknown>): BusinessBureauConnection {
  return {
    id: String(r.id),
    entity_id: String(r.entity_id),
    bureau: r.bureau as BusinessBureau,
    status: (r.status as BusinessBureauConnection['status']) ?? 'disconnected',
    last_successful_pull_at: r.last_successful_pull_at
      ? String(r.last_successful_pull_at)
      : null,
    notes: String(r.notes ?? ''),
  };
}

/** Tage first, then subs A–Z by display name. */
export function orderCompanies<T extends { entity_id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.entity_id === 'ENT-FIRM') return -1;
    if (b.entity_id === 'ENT-FIRM') return 1;
    return entityDisplayName(a.entity_id, a.entity_id).localeCompare(
      entityDisplayName(b.entity_id, b.entity_id),
    );
  });
}

export async function listBusinessBureauCompanies(): Promise<{
  companies: BusinessBureauCompany[];
  error?: string;
}> {
  try {
    const sb = await createPersistClient();
    const { data: profiles, error: pErr } = await sb
      .from('os_business_credit_profiles')
      .select('entity_id');
    if (pErr) return { companies: [], error: pErr.message };

    const entityIds = orderCompanies(
      (profiles ?? []).map((p) => ({ entity_id: String(p.entity_id) })),
    ).map((p) => p.entity_id);

    const { data: snaps } = await sb
      .from('os_business_credit_snapshots')
      .select('*')
      .order('pulled_at', { ascending: false });
    const { data: conns } = await sb
      .from('os_business_credit_connections')
      .select('*');

    const companies: BusinessBureauCompany[] = entityIds.map((entityId) => {
      const byBureau: BusinessBureauCompany['byBureau'] = {};
      for (const bureau of BUSINESS_BUREAUS) {
        const latest = (snaps ?? []).find(
          (s) => String(s.entity_id) === entityId && s.bureau === bureau,
        );
        byBureau[bureau] = latest
          ? mapSnapshot(latest as Record<string, unknown>)
          : null;
      }
      return {
        entity_id: entityId,
        company_name: entityDisplayName(entityId, entityId),
        byBureau,
        connections: (conns ?? [])
          .filter((c) => String(c.entity_id) === entityId)
          .map((c) => mapConnection(c as Record<string, unknown>)),
      };
    });

    return { companies };
  } catch (e) {
    return {
      companies: [],
      error: e instanceof Error ? e.message : 'Business bureaus unavailable',
    };
  }
}

/** Soft stale / missing-data alerts per company × bureau. Pure. */
export function businessBureauStaleAlerts(
  companies: BusinessBureauCompany[],
): Array<{ entity_id: string; company_name: string; message: string }> {
  const alerts: Array<{
    entity_id: string;
    company_name: string;
    message: string;
  }> = [];
  for (const c of companies) {
    for (const bureau of BUSINESS_BUREAUS) {
      const snap = c.byBureau[bureau];
      const label = BUSINESS_BUREAU_LABELS[bureau];
      if (!snap) continue; // "no data" surfaces on the card, not as an alert
      if (snap.stale) {
        alerts.push({
          entity_id: c.entity_id,
          company_name: c.company_name,
          message: `${label} data is ${snap.days_old} days old — refresh via guided export`,
        });
      }
    }
  }
  return alerts;
}

async function touchConnection(input: {
  entityId: string;
  bureau: BusinessBureau;
  status: BusinessBureauConnection['status'];
}) {
  const sb = await createPersistClient();
  await sb.from('os_business_credit_connections').upsert(
    {
      entity_id: input.entityId,
      bureau: input.bureau,
      status: input.status,
      last_successful_pull_at:
        input.status === 'connected_guided' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'entity_id,bureau' },
  );
}

export async function importBusinessCreditReport(input: {
  entityId: string;
  bureau: BusinessBureau;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  actorId: string | null;
  pasteText?: string | null;
}): Promise<
  | { ok: true; snapshot: BusinessBureauSnapshot; parse: BusinessParseResult }
  | { ok: false; error: string }
> {
  const parseEnabled =
    process.env.BUSINESS_CREDIT_PARSE_ENABLED !== '0' &&
    process.env.BUSINESS_CREDIT_PARSE_ENABLED !== 'false';

  try {
    const sb = await createPersistClient();
    const path = `business/${input.entityId}/${input.bureau}/${Date.now()}-${randomUUID().slice(0, 8)}-${input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    const { error: upErr } = await sb.storage
      .from(BUCKET)
      .upload(path, input.bytes, {
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

    const parse: BusinessParseResult = parseEnabled
      ? parseBusinessCreditReportText({
          text,
          preferredBureau: input.bureau,
        })
      : {
          bureau: input.bureau,
          report_date: null,
          identifiers: {},
          scores: {},
          summary: {},
          parse_status: 'partial',
          parse_errors: ['BUSINESS_CREDIT_PARSE_ENABLED=0 — raw file stored only'],
        };

    const parseErrors = [
      ...parse.parse_errors,
      upErr ? `storage: ${upErr.message}` : '',
    ]
      .filter(Boolean)
      .join('; ');

    // Idempotent-ish: same entity + bureau + report_date → update in place
    if (parse.report_date) {
      const { data: dup } = await sb
        .from('os_business_credit_snapshots')
        .select('id')
        .eq('entity_id', input.entityId)
        .eq('bureau', input.bureau)
        .eq('report_date', parse.report_date)
        .limit(1);
      if (dup && dup.length > 0) {
        await sb
          .from('os_business_credit_snapshots')
          .update({
            identifiers: parse.identifiers,
            scores: parse.scores,
            summary: parse.summary,
            raw_storage_path: upErr ? null : path,
            parse_status: parse.parse_status,
            parse_errors: parseErrors,
            pulled_at: new Date().toISOString(),
            source: 'guided_export',
          })
          .eq('id', dup[0].id);
        const { data: refreshed } = await sb
          .from('os_business_credit_snapshots')
          .select('*')
          .eq('id', dup[0].id)
          .single();
        await touchConnection({
          entityId: input.entityId,
          bureau: input.bureau,
          status: 'connected_guided',
        });
        await auditBureauEvent(input, parse, 'updated');
        return {
          ok: true,
          snapshot: mapSnapshot(refreshed as Record<string, unknown>),
          parse,
        };
      }
    }

    // Light delta vs previous snapshot (audit only — keep simple)
    const { data: prevRows } = await sb
      .from('os_business_credit_snapshots')
      .select('scores, summary')
      .eq('entity_id', input.entityId)
      .eq('bureau', input.bureau)
      .order('pulled_at', { ascending: false })
      .limit(1);
    const prev = prevRows?.[0];

    const { data, error } = await sb
      .from('os_business_credit_snapshots')
      .insert({
        entity_id: input.entityId,
        bureau: input.bureau,
        report_date: parse.report_date,
        source: 'guided_export',
        identifiers: parse.identifiers,
        scores: parse.scores,
        summary: parse.summary,
        raw_storage_path: upErr ? null : path,
        parse_status: upErr && parse.parse_status === 'parsed' ? 'partial' : parse.parse_status,
        parse_errors: parseErrors,
        created_by: input.actorId,
      })
      .select('*')
      .single();
    if (error || !data) {
      return { ok: false, error: error?.message ?? 'Snapshot insert failed' };
    }

    await touchConnection({
      entityId: input.entityId,
      bureau: input.bureau,
      status: 'connected_guided',
    });
    await auditBureauEvent(input, parse, 'created');

    if (prev) {
      const prevPrimary = primaryBusinessScore(
        input.bureau,
        (prev.scores as BusinessBureauScores) ?? {},
      );
      const nextPrimary = primaryBusinessScore(input.bureau, parse.scores);
      const prevPub = Number(
        (prev.summary as Record<string, unknown>)?.public_records ?? 0,
      );
      const nextPub = Number(parse.summary.public_records ?? 0);
      if (
        (prevPrimary.value != null &&
          nextPrimary.value != null &&
          prevPrimary.value !== nextPrimary.value) ||
        nextPub > prevPub
      ) {
        await writeAuditEvent({
          action: 'credit_alert',
          title: `${entityDisplayName(input.entityId)} · ${BUSINESS_BUREAU_LABELS[input.bureau]} change: ${nextPrimary.label} ${prevPrimary.value ?? 'n/a'} → ${nextPrimary.value ?? 'n/a'}${nextPub > prevPub ? ` · public records ${prevPub} → ${nextPub}` : ''}`,
          object_type: 'business_credit_snapshot',
          object_id: String(data.id),
          entity_id: input.entityId,
        });
      }
    }

    return {
      ok: true,
      snapshot: mapSnapshot(data as Record<string, unknown>),
      parse,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Business import failed',
    };
  }
}

async function auditBureauEvent(
  input: { entityId: string; bureau: BusinessBureau; actorId: string | null },
  parse: BusinessParseResult,
  verb: 'created' | 'updated',
) {
  await writeAuditEvent({
    action: 'credit_import',
    title: `Business credit snapshot ${verb} · ${entityDisplayName(input.entityId)} · ${BUSINESS_BUREAU_LABELS[input.bureau]} (${parse.parse_status})`,
    object_type: 'business_credit_snapshot',
    object_id: `${input.entityId}:${input.bureau}`,
    entity_id: input.entityId,
    metadata: {
      bureau: input.bureau,
      parse_status: parse.parse_status,
      report_date: parse.report_date,
    },
  });
}

/** Manual identifiers + primary scores when PDF parse is incomplete. */
export async function saveBusinessBureauManual(input: {
  entityId: string;
  bureau: BusinessBureau;
  identifiers: BusinessBureauIdentifiers;
  scores: BusinessBureauScores;
  reportDate?: string | null;
  actorId: string | null;
}): Promise<
  { ok: true; snapshot: BusinessBureauSnapshot } | { ok: false; error: string }
> {
  try {
    const hasAny =
      Object.values(input.scores).some((v) => typeof v === 'number') ||
      Object.values(input.identifiers).some(
        (v) => typeof v === 'string' && v.trim(),
      );
    if (!hasAny) {
      return { ok: false, error: 'Enter at least one identifier or score' };
    }
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_business_credit_snapshots')
      .insert({
        entity_id: input.entityId,
        bureau: input.bureau,
        report_date: input.reportDate || null,
        source: 'manual_entry',
        identifiers: input.identifiers,
        scores: input.scores,
        summary: {},
        parse_status: 'parsed',
        parse_errors: '',
        created_by: input.actorId,
      })
      .select('*')
      .single();
    if (error || !data) {
      return { ok: false, error: error?.message ?? 'Manual save failed' };
    }
    await touchConnection({
      entityId: input.entityId,
      bureau: input.bureau,
      status: 'connected_guided',
    });
    await writeAuditEvent({
      action: 'credit_import',
      title: `Business credit manual entry · ${entityDisplayName(input.entityId)} · ${BUSINESS_BUREAU_LABELS[input.bureau]}`,
      object_type: 'business_credit_snapshot',
      object_id: String(data.id),
      entity_id: input.entityId,
      metadata: { bureau: input.bureau, source: 'manual_entry' },
    });
    return { ok: true, snapshot: mapSnapshot(data as Record<string, unknown>) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Manual save failed',
    };
  }
}

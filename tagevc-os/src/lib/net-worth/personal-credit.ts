/**
 * Dual-person personal credit (Josh / Lauren) — Visionary-only.
 */

import { randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { writeAuditEvent } from '@/lib/audit/write';
import {
  daysSince,
  extractTextFromPdfBuffer,
  isStale,
  parseCreditReportText,
  primaryFico10,
  primaryFico8,
  type CreditBureau,
  type FicoScores,
  type ParseResult,
} from '@/lib/net-worth/credit-parse';
import type {
  CreditAlert,
  CreditConnection,
  CreditSnapshot,
  CreditSubject,
  PersonKey,
} from '@/lib/net-worth/credit-types';
import {
  CREDIT_PRIVATE_BUCKET,
  CREDIT_STALE_DAYS,
} from '@/lib/net-worth/personal-credit-consts';

export type {
  CreditAlert,
  CreditConnection,
  CreditSnapshot,
  CreditSubject,
  PersonKey,
};
export { CREDIT_PRIVATE_BUCKET, CREDIT_STALE_DAYS };

function mapSubject(r: Record<string, unknown>): CreditSubject {
  return {
    id: String(r.id),
    person_key: r.person_key as PersonKey,
    display_name: String(r.display_name),
    relationship: r.relationship as 'self' | 'spouse',
    consent_noted_at: r.consent_noted_at ? String(r.consent_noted_at) : null,
    notes: String(r.notes ?? ''),
  };
}

function mapSnapshot(r: Record<string, unknown>): CreditSnapshot {
  const scores = (r.scores ?? {}) as FicoScores;
  const pulled = String(r.pulled_at);
  return {
    id: String(r.id),
    subject_id: String(r.subject_id),
    bureau: r.bureau as CreditBureau,
    pulled_at: pulled,
    source: String(r.source),
    report_date: r.report_date ? String(r.report_date).slice(0, 10) : null,
    scores,
    summary: (r.summary as Record<string, unknown>) ?? {},
    raw_storage_path: (r.raw_storage_path as string) ?? null,
    parse_status: String(r.parse_status ?? 'pending'),
    parse_errors: String(r.parse_errors ?? ''),
    fico_8: primaryFico8(scores),
    fico_10: primaryFico10(scores),
    days_old: daysSince(pulled),
    stale: isStale(pulled, CREDIT_STALE_DAYS),
  };
}

export async function listCreditSubjects(): Promise<{
  rows: CreditSubject[];
  error?: string;
}> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_personal_credit_subjects')
      .select('*')
      .order('person_key', { ascending: true });
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((r) => mapSubject(r as Record<string, unknown>)),
    };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : 'Subjects unavailable',
    };
  }
}

export async function listSnapshotsForSubject(
  subjectId: string,
  limit = 20,
): Promise<CreditSnapshot[]> {
  try {
    const sb = await createPersistClient();
    const { data } = await sb
      .from('os_personal_credit_snapshots')
      .select('*')
      .eq('subject_id', subjectId)
      .order('pulled_at', { ascending: false })
      .limit(limit);
    return (data ?? []).map((r) => mapSnapshot(r as Record<string, unknown>));
  } catch {
    return [];
  }
}

export async function listConnectionsForSubject(
  subjectId: string,
): Promise<CreditConnection[]> {
  try {
    const sb = await createPersistClient();
    const { data } = await sb
      .from('os_personal_credit_connections')
      .select('*')
      .eq('subject_id', subjectId);
    return (data ?? []).map((r) => ({
      id: String(r.id),
      subject_id: String(r.subject_id),
      provider: r.provider as CreditConnection['provider'],
      status: r.status as CreditConnection['status'],
      last_successful_pull_at: r.last_successful_pull_at
        ? String(r.last_successful_pull_at)
        : null,
      notes: String(r.notes ?? ''),
    }));
  } catch {
    return [];
  }
}

export async function listOpenCreditAlerts(
  subjectId?: string,
): Promise<CreditAlert[]> {
  try {
    const sb = await createPersistClient();
    let q = sb
      .from('os_personal_credit_alerts')
      .select('*')
      .is('acknowledged_at', null)
      .order('created_at', { ascending: false })
      .limit(40);
    if (subjectId) q = q.eq('subject_id', subjectId);
    const { data } = await q;
    return (data ?? []).map((r) => ({
      id: String(r.id),
      subject_id: String(r.subject_id),
      kind: String(r.kind),
      title: String(r.title),
      created_at: String(r.created_at),
      acknowledged_at: null,
    }));
  } catch {
    return [];
  }
}

async function writeStaleAlerts(subjects: CreditSubject[], latestBySubject: Map<string, CreditSnapshot>) {
  const sb = await createPersistClient();
  for (const s of subjects) {
    const latest = latestBySubject.get(s.id);
    if (!latest?.stale) continue;
    const { data: existing } = await sb
      .from('os_personal_credit_alerts')
      .select('id')
      .eq('subject_id', s.id)
      .eq('kind', 'stale')
      .is('acknowledged_at', null)
      .limit(1);
    if (existing && existing.length > 0) continue;
    await sb.from('os_personal_credit_alerts').insert({
      subject_id: s.id,
      snapshot_id: latest.id,
      kind: 'stale',
      title: `${s.display_name} FICO data is ${latest.days_old} days old — refresh via myFICO or Experian?`,
      detail: { days_old: latest.days_old, threshold: CREDIT_STALE_DAYS },
    });
  }
}

export async function loadDualPersonCreditBundle(opts?: {
  silent?: boolean;
}): Promise<{
  subjects: CreditSubject[];
  byPerson: Record<
    PersonKey,
    {
      subject: CreditSubject;
      latest: CreditSnapshot | null;
      history: CreditSnapshot[];
      connections: CreditConnection[];
      scoreTrend8: number[];
      scoreTrend10: number[];
    }
  >;
  alerts: CreditAlert[];
  error?: string;
}> {
  const { rows: subjects, error } = await listCreditSubjects();
  const empty = {
    subjects: [],
    byPerson: {} as never,
    alerts: [] as CreditAlert[],
    error,
  };
  if (error || subjects.length === 0) return empty;

  if (!opts?.silent) {
    await writeAuditEvent({
      action: 'credit_access',
      title: 'Personal credit dual-person viewed',
      object_type: 'personal_credit',
      object_id: 'josh_lauren',
    });
  }

  const byPerson = {} as Awaited<
    ReturnType<typeof loadDualPersonCreditBundle>
  >['byPerson'];
  const latestMap = new Map<string, CreditSnapshot>();

  for (const s of subjects) {
    const history = await listSnapshotsForSubject(s.id, 24);
    const latest = history[0] ?? null;
    if (latest) latestMap.set(s.id, latest);
    const connections = await listConnectionsForSubject(s.id);
    byPerson[s.person_key] = {
      subject: s,
      latest,
      history,
      connections,
      scoreTrend8: history
        .map((h) => h.fico_8)
        .filter((n): n is number => typeof n === 'number')
        .reverse(),
      scoreTrend10: history
        .map((h) => h.fico_10)
        .filter((n): n is number => typeof n === 'number')
        .reverse(),
    };
  }

  if (!opts?.silent) {
    await writeStaleAlerts(subjects, latestMap).catch(() => undefined);
  }
  const alerts = await listOpenCreditAlerts();

  return { subjects, byPerson, alerts, error };
}

async function computeDeltasAndAlerts(input: {
  subjectId: string;
  snapshotId: string;
  scores: FicoScores;
  summary: Record<string, unknown>;
  displayName: string;
}) {
  const sb = await createPersistClient();
  const { data: prevRows } = await sb
    .from('os_personal_credit_snapshots')
    .select('*')
    .eq('subject_id', input.subjectId)
    .neq('id', input.snapshotId)
    .order('pulled_at', { ascending: false })
    .limit(1);
  const prev = prevRows?.[0];
  if (!prev) return;

  const prevScores = (prev.scores ?? {}) as FicoScores;
  const prev8 = primaryFico8(prevScores);
  const next8 = primaryFico8(input.scores);
  const prev10 = primaryFico10(prevScores);
  const next10 = primaryFico10(input.scores);

  const alerts: Array<{ kind: string; title: string; detail: Record<string, unknown> }> =
    [];
  if (prev8 != null && next8 != null && prev8 !== next8) {
    alerts.push({
      kind: 'score_change',
      title: `${input.displayName} FICO 8 ${prev8} → ${next8} (${next8 - prev8 >= 0 ? '+' : ''}${next8 - prev8})`,
      detail: { from: prev8, to: next8, score: 'fico_8' },
    });
  }
  if (prev10 != null && next10 != null && prev10 !== next10) {
    alerts.push({
      kind: 'score_change',
      title: `${input.displayName} FICO 10 ${prev10} → ${next10} (${next10 - prev10 >= 0 ? '+' : ''}${next10 - prev10})`,
      detail: { from: prev10, to: next10, score: 'fico_10' },
    });
  }
  const prevUtil = Number(
    (prev.summary as Record<string, unknown>)?.utilization_pct ?? NaN,
  );
  const nextUtil = Number(input.summary.utilization_pct ?? NaN);
  if (
    !Number.isNaN(prevUtil) &&
    !Number.isNaN(nextUtil) &&
    nextUtil - prevUtil >= 10
  ) {
    alerts.push({
      kind: 'utilization_spike',
      title: `${input.displayName} utilization spiked ${prevUtil}% → ${nextUtil}%`,
      detail: { from: prevUtil, to: nextUtil },
    });
  }

  for (const a of alerts) {
    await sb.from('os_personal_credit_alerts').insert({
      subject_id: input.subjectId,
      snapshot_id: input.snapshotId,
      kind: a.kind,
      title: a.title,
      detail: a.detail,
    });
  }
}

export async function importCreditReport(input: {
  subjectId: string;
  displayName: string;
  source: 'myfico' | 'experian' | 'equifax' | 'annualcreditreport' | 'other' | 'manual_upload';
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  actorId: string | null;
  pasteText?: string | null;
}): Promise<
  | { ok: true; snapshot: CreditSnapshot; parse: ParseResult }
  | { ok: false; error: string }
> {
  const parseEnabled =
    process.env.CREDIT_PARSE_ENABLED !== '0' &&
    process.env.CREDIT_PARSE_ENABLED !== 'false';

  try {
    const sb = await createPersistClient();
    const path = `${input.subjectId}/${Date.now()}-${randomUUID().slice(0, 8)}-${input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    const { error: upErr } = await sb.storage
      .from(CREDIT_PRIVATE_BUCKET)
      .upload(path, input.bytes, {
        contentType: input.mimeType || 'application/octet-stream',
        upsert: false,
      });

    let text = input.pasteText?.trim() || '';
    if (!text) {
      if (
        input.mimeType.includes('text') ||
        input.fileName.toLowerCase().endsWith('.txt')
      ) {
        text = input.bytes.toString('utf8');
      } else if (
        input.mimeType.includes('pdf') ||
        input.fileName.toLowerCase().endsWith('.pdf')
      ) {
        text = extractTextFromPdfBuffer(input.bytes);
      } else {
        text = input.bytes.toString('utf8');
      }
    }

    const parse = parseEnabled
      ? parseCreditReportText({
          text,
          preferredSource:
            input.source === 'manual_upload' ? undefined : input.source,
        })
      : {
          bureau: 'tri_merge' as const,
          source_guess: input.source === 'manual_upload' ? 'other' as const : input.source,
          report_date: null,
          scores: {},
          summary: {},
          tradelines: [],
          inquiries: [],
          parse_status: 'partial' as const,
          parse_errors: ['CREDIT_PARSE_ENABLED=0'],
        };

    // Idempotent-ish: same subject+bureau+source+report_date
    if (parse.report_date) {
      const { data: dup } = await sb
        .from('os_personal_credit_snapshots')
        .select('id')
        .eq('subject_id', input.subjectId)
        .eq('bureau', parse.bureau)
        .eq('source', input.source === 'manual_upload' ? parse.source_guess : input.source)
        .eq('report_date', parse.report_date)
        .limit(1);
      if (dup && dup.length > 0) {
        await sb
          .from('os_personal_credit_snapshots')
          .update({
            scores: parse.scores,
            summary: parse.summary,
            raw_storage_path: upErr ? null : path,
            parse_status: parse.parse_status === 'failed' ? 'failed' : parse.parse_status,
            parse_errors: [
              ...(parse.parse_errors ?? []),
              upErr ? `storage: ${upErr.message}` : '',
            ]
              .filter(Boolean)
              .join('; '),
            pulled_at: new Date().toISOString(),
          })
          .eq('id', dup[0].id);
        const { data: refreshed } = await sb
          .from('os_personal_credit_snapshots')
          .select('*')
          .eq('id', dup[0].id)
          .single();
        return {
          ok: true,
          snapshot: mapSnapshot(refreshed as Record<string, unknown>),
          parse: parse as ParseResult,
        };
      }
    }

    const source =
      input.source === 'manual_upload' ? parse.source_guess : input.source;

    const { data, error } = await sb
      .from('os_personal_credit_snapshots')
      .insert({
        subject_id: input.subjectId,
        bureau: parse.bureau,
        source,
        report_date: parse.report_date,
        scores: parse.scores,
        summary: parse.summary,
        raw_storage_path: upErr ? null : path,
        parse_status:
          parse.parse_status === 'failed'
            ? 'failed'
            : upErr
              ? 'partial'
              : parse.parse_status,
        parse_errors: [
          ...(parse.parse_errors ?? []),
          upErr
            ? `storage: ${upErr.message} (create bucket credit-private if missing)`
            : '',
        ]
          .filter(Boolean)
          .join('; '),
        created_by: input.actorId,
      })
      .select('*')
      .single();

    if (error || !data) {
      return { ok: false, error: error?.message ?? 'Snapshot insert failed' };
    }

    const snapshotId = String(data.id);
    if (parse.tradelines.length) {
      await sb.from('os_personal_credit_tradelines').insert(
        parse.tradelines.map((t) => ({
          snapshot_id: snapshotId,
          creditor_name: t.creditor_name,
          account_type: t.account_type,
          balance: t.balance,
          credit_limit: t.credit_limit,
          is_negative: t.is_negative,
          is_collection: t.is_collection,
          is_chargeoff: t.is_chargeoff,
          status: t.status,
        })),
      );
    }
    if (parse.inquiries.length) {
      await sb.from('os_personal_credit_inquiries').insert(
        parse.inquiries.map((i) => ({
          snapshot_id: snapshotId,
          creditor_name: i.creditor_name,
          inquiry_date: i.inquiry_date,
          inquiry_type: i.inquiry_type,
        })),
      );
    }

    await sb
      .from('os_personal_credit_connections')
      .upsert(
        {
          subject_id: input.subjectId,
          provider:
            source === 'myfico'
              ? 'myfico'
              : source === 'experian'
                ? 'experian'
                : 'other',
          status: 'connected_guided',
          last_successful_pull_at: new Date().toISOString(),
          notes: `Last import: ${input.fileName}`,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'subject_id,provider' },
      );

    await computeDeltasAndAlerts({
      subjectId: input.subjectId,
      snapshotId,
      scores: parse.scores,
      summary: parse.summary as Record<string, unknown>,
      displayName: input.displayName,
    });

    await writeAuditEvent({
      action: 'credit_import',
      title: `Credit report imported · ${input.displayName} · ${source}`,
      object_type: 'credit_snapshot',
      object_id: snapshotId,
      metadata: {
        source,
        bureau: parse.bureau,
        fico_8: primaryFico8(parse.scores),
        fico_10: primaryFico10(parse.scores),
        parse_status: parse.parse_status,
      },
    });

    return {
      ok: true,
      snapshot: mapSnapshot(data as Record<string, unknown>),
      parse: parse as ParseResult,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Import failed',
    };
  }
}

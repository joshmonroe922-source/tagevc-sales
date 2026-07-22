import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  MAX_REVENUE_BODY_BYTES,
  MAX_REVENUE_PAGES,
  MAX_REVENUE_RECORDS,
  REVENUE_REPORT_VERSION,
  authoritativeRevenuePageSchema,
  canonicalizeRevenueRecord,
  sha256,
  verifyRevenueAuthenticity,
  type CanonicalRevenueRow,
  type Phase40RevenueReport,
  type RevenueAuthenticityMode,
  type RevenueReceipt,
} from '@/lib/shared-services/marketing-revenue-contracts';
import { runPhase43RevenueOpsTick } from '@/lib/shared-services/marketing-phase43';
import { runPhase44RevenueOpsTick } from '@/lib/shared-services/marketing-phase44';
import { runPhase45RevenueOpsTick } from '@/lib/shared-services/marketing-phase45';
import { runPhase46RevenueOpsTick } from '@/lib/shared-services/marketing-phase46';
import { createPersistClient } from '@/lib/supabase/persist-client';

type PullRun = {
  run_id: string;
  source_id: string;
  entity_id: string;
  ad_account_id: string;
  start_cursor: string | null;
  window_start: string;
  window_end: string;
  lease_token: string;
};

type RevenueSource = {
  source_id: string;
  entity_id: string;
  endpoint_url: string;
  credential_env_name: string;
  signature_env_name: string | null;
  authenticity_mode: RevenueAuthenticityMode;
  config_status: string;
  ledger_profile?: string | null;
  ledger_kind?: string | null;
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Revenue ingestion requires Supabase service-role configuration');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function requiresSignatureSecret(mode: RevenueAuthenticityMode): boolean {
  return (
    mode === 'hmac_sha256' ||
    mode === 'signed_headers_v1' ||
    mode === 'jwt_bearer_v1'
  );
}

async function recordAuthenticityProbe(
  sb: ReturnType<typeof serviceClient>,
  input: {
    source_id: string;
    run_id: string;
    entity_id: string;
    authenticity_mode: RevenueAuthenticityMode;
    probe_result: 'verified' | 'failed';
    page_number: number;
    error_code?: string;
    evidence: ReturnType<typeof verifyRevenueAuthenticity>['evidence'];
  },
) {
  await sb.rpc('record_marketing_revenue_authenticity_probe', {
    p_probe: {
      source_id: input.source_id,
      run_id: input.run_id,
      entity_id: input.entity_id,
      authenticity_mode: input.authenticity_mode,
      probe_result: input.probe_result,
      page_number: input.page_number,
      request_id_sha256: input.evidence.request_id_sha256,
      body_sha256: input.evidence.body_sha256,
      header_digest_sha256: input.evidence.header_digest_sha256,
      claims_digest_sha256: input.evidence.claims_digest_sha256,
      error_code: input.error_code ?? null,
      metadata: input.evidence.metadata,
    },
  });
}

function checkedEndpoint(raw: string): URL {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    host === 'localhost' ||
    host.endsWith('.local') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0$)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '::1'
  ) {
    throw new Error('Revenue source endpoint is not an allowed public HTTPS URL');
  }
  return url;
}

async function delay(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchPage(
  url: URL,
  credential: string,
): Promise<{ response: Response; body: string }> {
  let last: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${credential}`,
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.text();
      if (new TextEncoder().encode(body).length > MAX_REVENUE_BODY_BYTES) {
        throw new Error('Revenue source response exceeds 1 MiB');
      }
      if (response.ok) return { response, body };
      const retryable = response.status === 429 || response.status >= 500;
      last = Object.assign(new Error(`Revenue source HTTP ${response.status}`), {
        retryable,
      });
      if (!retryable) throw last;
    } catch (error) {
      last = error instanceof Error ? error : new Error('Revenue source fetch failed');
      const retryable =
        (last as Error & { retryable?: boolean }).retryable !== false;
      if (!retryable || attempt === 2) throw last;
    }
    await delay(250 * 2 ** attempt);
  }
  throw last ?? new Error('Revenue source fetch failed');
}

async function pullSource(
  run: PullRun,
  source: RevenueSource,
  heartbeat: () => Promise<void>,
  onProbe: (input: {
    page_number: number;
    probe_result: 'verified' | 'failed';
    error_code?: string;
    evidence: ReturnType<typeof verifyRevenueAuthenticity>['evidence'];
  }) => Promise<void>,
): Promise<{
  rows: CanonicalRevenueRow[];
  receipts: RevenueReceipt[];
  endCursor: string | null;
  expectedRecords: number;
}> {
  if (source.config_status !== 'ready') {
    throw Object.assign(new Error('Revenue source is not ready'), {
      retryable: false,
      code: 'source_not_ready',
    });
  }
  const credential = process.env[source.credential_env_name]?.trim();
  const signatureSecret = source.signature_env_name
    ? process.env[source.signature_env_name]?.trim()
    : undefined;
  if (
    !credential ||
    (requiresSignatureSecret(source.authenticity_mode) && !signatureSecret)
  ) {
    throw Object.assign(new Error('Revenue source credential or signature secret is missing'), {
      retryable: false,
      code: 'source_secret_missing',
    });
  }

  const endpoint = checkedEndpoint(source.endpoint_url);
  const rows: CanonicalRevenueRow[] = [];
  const receipts: RevenueReceipt[] = [];
  const seenCursors = new Set<string>();
  const seenRows = new Set<string>();
  let cursor = run.start_cursor;
  let expectedRecords: number | null = null;

  for (let pageNumber = 1; pageNumber <= MAX_REVENUE_PAGES; pageNumber += 1) {
    await heartbeat();
    const pageUrl = new URL(endpoint);
    pageUrl.searchParams.set('window_start', run.window_start);
    pageUrl.searchParams.set('window_end', run.window_end);
    pageUrl.searchParams.set('limit', '100');
    if (cursor) pageUrl.searchParams.set('cursor', cursor);
    const fetchedAt = new Date().toISOString();
    const { response, body } = await fetchPage(pageUrl, credential);
    let decoded: unknown;
    try {
      decoded = JSON.parse(body);
    } catch {
      throw Object.assign(new Error('Revenue source returned malformed JSON'), {
        retryable: false,
        code: 'contract_invalid',
      });
    }
    const parsed = authoritativeRevenuePageSchema.safeParse(decoded);
    if (!parsed.success) {
      throw Object.assign(
        new Error(parsed.error.issues[0]?.message ?? 'Revenue source contract invalid'),
        { retryable: false, code: 'contract_invalid' },
      );
    }
    const providerRequestId = response.headers.get('x-request-id');
    if (providerRequestId && providerRequestId !== parsed.data.request_id) {
      throw Object.assign(new Error('Revenue source request identity mismatch'), {
        retryable: false,
        code: 'authenticity_failed',
      });
    }
    const authentic = verifyRevenueAuthenticity({
      mode: source.authenticity_mode,
      rawBody: body,
      requestId: parsed.data.request_id,
      signature: response.headers.get('x-source-signature'),
      signatureSecret,
      contentSha256Header: response.headers.get('x-content-sha256'),
      sourceJwt: response.headers.get('x-source-jwt'),
    });
    if (!authentic.ok) {
      await onProbe({
        page_number: pageNumber,
        probe_result: 'failed',
        error_code: 'authenticity_failed',
        evidence: authentic.evidence,
      });
      throw Object.assign(new Error('Revenue source authenticity verification failed'), {
        retryable: false,
        code: 'authenticity_failed',
      });
    }
    await onProbe({
      page_number: pageNumber,
      probe_result: 'verified',
      evidence: authentic.evidence,
    });
    if (
      expectedRecords !== null &&
      expectedRecords !== parsed.data.expected_records
    ) {
      throw Object.assign(new Error('Revenue source completeness denominator changed by page'), {
        retryable: false,
        code: 'denominator_changed',
      });
    }
    expectedRecords = parsed.data.expected_records;
    for (const sourceRecord of parsed.data.records) {
      const canonical = canonicalizeRevenueRecord(sourceRecord);
      const key = [
        canonical.source_record_id,
        canonical.revenue_event_id,
        canonical.attribution_model,
        canonical.cohort_key,
        canonical.source_revision,
      ].join(':');
      if (seenRows.has(key)) {
        throw Object.assign(new Error(`Duplicate revenue allocation ${key}`), {
          retryable: false,
          code: 'duplicate_record',
        });
      }
      seenRows.add(key);
      rows.push(canonical);
      if (rows.length > MAX_REVENUE_RECORDS) {
        throw Object.assign(new Error('Revenue pull exceeds 500 records'), {
          retryable: false,
          code: 'record_limit',
        });
      }
    }
    receipts.push({
      page_number: pageNumber,
      request_id: parsed.data.request_id,
      fetched_at: fetchedAt,
      http_status: response.status,
      body_bytes: new TextEncoder().encode(body).length,
      body_sha256: sha256(body),
      authenticity_verified: true,
      cursor_in_sha256: cursor ? sha256(cursor) : null,
      cursor_out_sha256: parsed.data.next_cursor
        ? sha256(parsed.data.next_cursor)
        : null,
      metadata: { content_type: response.headers.get('content-type') },
    });
    if (!parsed.data.has_more) {
      return {
        rows,
        receipts,
        endCursor: parsed.data.next_cursor,
        expectedRecords,
      };
    }
    if (!parsed.data.next_cursor || seenCursors.has(parsed.data.next_cursor)) {
      throw Object.assign(new Error('Revenue source pagination cursor stalled'), {
        retryable: false,
        code: 'cursor_stalled',
      });
    }
    seenCursors.add(parsed.data.next_cursor);
    cursor = parsed.data.next_cursor;
  }
  throw Object.assign(new Error('Revenue source exceeded 10 pages'), {
    retryable: false,
    code: 'page_limit',
  });
}

export async function processMarketingRevenuePulls(limit = 1): Promise<{
  claimed: number;
  completed: number;
  failed: number;
  details: string[];
}> {
  const sb = serviceClient();
  await sb.rpc('enqueue_due_marketing_revenue_pulls', {
    p_limit: Math.min(Math.max(limit * 2, 1), 10),
  });
  const { data, error } = await sb.rpc('claim_marketing_revenue_pull_runs', {
    p_worker_id: `revenue-${randomUUID()}`,
    p_limit: Math.min(Math.max(limit, 1), 5),
    p_lease_seconds: 180,
  });
  if (error) throw new Error(error.message);
  const runs = (data ?? []) as PullRun[];
  let completed = 0;
  let failed = 0;
  const details: string[] = [];
  const productionEntities = new Set<string>();
  for (const run of runs) {
    try {
      const { data: source, error: sourceError } = await sb
        .from('os_marketing_revenue_sources')
        .select(
          'source_id,entity_id,endpoint_url,credential_env_name,signature_env_name,authenticity_mode,config_status,ledger_profile,ledger_kind',
        )
        .eq('source_id', run.source_id)
        .single();
      if (sourceError || !source) {
        throw Object.assign(new Error(sourceError?.message ?? 'Revenue source missing'), {
          retryable: false,
          code: 'source_missing',
        });
      }
      if ((source as RevenueSource).ledger_profile === 'production_v1') {
        productionEntities.add(run.entity_id);
      }
      const result = await pullSource(
        run,
        source as RevenueSource,
        async () => {
          const { data: alive, error: heartbeatError } = await sb.rpc(
            'heartbeat_marketing_revenue_pull',
            {
              p_run_id: run.run_id,
              p_lease_token: run.lease_token,
              p_lease_seconds: 180,
            },
          );
          if (heartbeatError || alive !== true) {
            throw Object.assign(
              new Error(heartbeatError?.message ?? 'Revenue pull lease expired'),
              {
                retryable: true,
                code: 'lease_lost',
              },
            );
          }
        },
        async (probe) => {
          await recordAuthenticityProbe(sb, {
            source_id: run.source_id,
            run_id: run.run_id,
            entity_id: run.entity_id,
            authenticity_mode: (source as RevenueSource).authenticity_mode,
            ...probe,
          });
        },
      );
      const { data: completion, error: completeError } = await sb.rpc(
        'complete_marketing_revenue_pull',
        {
          p_run_id: run.run_id,
          p_lease_token: run.lease_token,
          p_pages: result.receipts,
          p_rows: result.rows,
          p_end_cursor: result.endCursor,
          p_expected_records: result.expectedRecords,
        },
      );
      if (completeError) throw new Error(completeError.message);
      if ((completion as { status?: string } | null)?.status !== 'completed') {
        details.push(`${run.run_id}: superseded by source configuration`);
        continue;
      }
      completed += 1;
      details.push(`${run.run_id}: completed ${result.rows.length} records`);
    } catch (caught) {
      failed += 1;
      const typed = caught as Error & { retryable?: boolean; code?: string };
      const message = typed.message || 'Revenue pull failed';
      await sb.rpc('fail_marketing_revenue_pull', {
        p_run_id: run.run_id,
        p_lease_token: run.lease_token,
        p_retryable: typed.retryable !== false,
        p_error_code: typed.code ?? 'pull_failed',
        p_error_detail: message,
      });
      details.push(`${run.run_id}: ${message}`);
    }
  }

  // Phase 42: record authenticity/settlement SLO ticks for production ledgers.
  for (const entityId of productionEntities) {
    try {
      const { error: sloError } = await sb.rpc(
        'record_marketing_revenue_phase42_slo_snapshots',
        {
          p_entity_id: entityId,
          p_days: 30,
          p_ledger_profile: 'production_v1',
        },
      );
      if (sloError) {
        details.push(`phase42-slo:${entityId}: ${sloError.message}`);
      } else {
        details.push(`phase42-slo:${entityId}: recorded`);
      }
    } catch (sloCaught) {
      const message =
        sloCaught instanceof Error ? sloCaught.message : 'Phase 42 SLO tick failed';
      details.push(`phase42-slo:${entityId}: ${message}`);
    }

    // Phase 43: credential binding health + critical-window ops alerts.
    const phase43 = await runPhase43RevenueOpsTick({
      entityId,
      days: 30,
    });
    if (!phase43.ok) {
      details.push(`phase43-ops:${entityId}: ${phase43.error}`);
    } else {
      details.push(
        `phase43-ops:${entityId}: bindings=${phase43.bindingsRecorded} alerts=${phase43.alertsRecorded} delivered=${phase43.delivered}`,
      );
    }

    // Phase 44: correction validation, attribution conflicts, recon snapshots.
    const phase44 = await runPhase44RevenueOpsTick({
      entityId,
      days: 30,
    });
    if (!phase44.ok) {
      details.push(`phase44-ops:${entityId}: ${phase44.error}`);
    } else {
      details.push(
        `phase44-ops:${entityId}: validated=${phase44.validations.passed + phase44.validations.failed + phase44.validations.auto_rejected} conflicts=${phase44.conflictsInserted} snapshots=${phase44.snapshotsRecorded} alerts=${phase44.alertsRecorded}`,
      );
    }

    // Phase 45: webhook delivery SLOs, workflow snapshots, tuned-rule alerts.
    const phase45 = await runPhase45RevenueOpsTick({
      entityId,
      days: 30,
    });
    if (!phase45.ok) {
      details.push(`phase45-ops:${entityId}: ${phase45.error}`);
    } else {
      details.push(
        `phase45-ops:${entityId}: webhook=${phase45.webhookSnapshots} workflow=${phase45.workflowSnapshots} alerts=${phase45.alertsRecorded}`,
      );
    }

    // Phase 46: promotion gates, rule performance, webhook reliability trends.
    const phase46 = await runPhase46RevenueOpsTick({
      entityId,
      days: 30,
    });
    if (!phase46.ok) {
      details.push(`phase46-ops:${entityId}: ${phase46.error}`);
    } else {
      details.push(
        `phase46-ops:${entityId}: performance=${phase46.performanceSnapshots} reliability=${phase46.reliabilitySnapshots} alerts=${phase46.alertsRecorded}`,
      );
    }
  }

  return { claimed: runs.length, completed, failed, details };
}

export async function getPhase40RevenueReport(input: {
  entityId: string | null;
  firmWide: boolean;
  days: 7 | 30 | 90;
}): Promise<{ report: Phase40RevenueReport; error?: string }> {
  const empty: Phase40RevenueReport = {
    version: REVENUE_REPORT_VERSION,
    comparison_semantics:
      'Descriptive allocations on aligned cohorts/windows/currencies; differences do not establish causality.',
    expected_records: 0,
    observed_records: 0,
    completeness_percent: null,
    late_records: 0,
    pending_corrections: 0,
    approved_corrections: 0,
    sources: [],
    model_comparisons: [],
  };
  if (!input.firmWide && !input.entityId) {
    return { report: empty, error: 'Entity-scoped revenue report requires an entity' };
  }
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('get_marketing_revenue_phase40_report', {
    p_entity_id: input.entityId,
    p_days: input.days,
  });
  if (error) return { report: empty, error: error.message };
  const report = data as Phase40RevenueReport | null;
  if (!report || report.version !== REVENUE_REPORT_VERSION) {
    return { report: empty, error: 'Phase 40 revenue report contract mismatch' };
  }
  return {
    report: {
      ...empty,
      ...report,
      sources: (report.sources ?? []).slice(0, 100),
      model_comparisons: (report.model_comparisons ?? []).slice(0, 200),
    },
  };
}

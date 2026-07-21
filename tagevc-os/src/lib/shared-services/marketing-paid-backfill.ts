import { createHash, randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { ensureFreshAccessToken } from '@/lib/shared-services/marketing-token-refresh';
import {
  type AccountMetricRow,
  PAID_CONTRACT_VERSION,
  PaidAuthorizationAmbiguousError,
  PaidContractError,
  PaidProviderInconsistentError,
  classifyPaidFailure,
  linkedinAccountAccessConfirmed,
  parseLinkedInAccountPage,
  parseLinkedInCampaignPage,
  parseMetaAccountPage,
  parseMetaCampaignPage,
  reconcileAccountDailyTotals,
} from '@/lib/shared-services/marketing-paid-contracts';

type SyncRun = {
  run_id: string;
  ad_account_id: string;
  entity_id: string | null;
  provider: 'meta_ads' | 'linkedin_ads';
  external_account_id: string;
  reporting_timezone: string;
  window_start: string;
  window_end: string;
  purpose: 'bootstrap_90d' | 'rolling_28d' | 'manual';
  trigger_source: 'cron' | 'manual';
  requested_by: string | null;
  lease_token: string;
};

type BoundCampaign = {
  campaign_id: string;
  external_campaign_id: string;
  conversion_metric: string | null;
};

type MetricRow = {
  campaign_id: string;
  external_campaign_id: string;
  metric_date: string;
  impressions: number;
  clicks: number;
  spend: string;
  conversions: string | null;
  provider_metrics: Record<string, unknown>;
  row_fingerprint: string;
};

type ProviderRequestId = {
  scope: 'account' | 'account_access' | 'campaign';
  provider_object_ids: string[];
  request_id: string;
};

function preserveRequestId(
  target: ProviderRequestId[],
  input: Omit<ProviderRequestId, 'request_id'> & {
    request_id: string | null;
  },
) {
  if (input.request_id) {
    target.push({
      scope: input.scope,
      provider_object_ids: input.provider_object_ids,
      request_id: input.request_id,
    });
  }
}

function shiftDate(iso: string, days: number): string {
  const value = new Date(`${iso}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function providerToday(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function datePart(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `(year:${year},month:${month},day:${day})`;
}

function fingerprint(row: Omit<MetricRow, 'row_fingerprint'>): string {
  return createHash('sha256').update(JSON.stringify(row)).digest('hex');
}

export async function enqueueScheduledPaidWindows(input?: {
  source?: 'cron' | 'manual';
  requestedBy?: string | null;
  accountId?: string;
}): Promise<{ queued: number; errors: string[] }> {
  const sb = await createPersistClient();
  let query = sb
    .from('os_marketing_social_accounts')
    .select(
      'account_id, platform, timezone, paid_metrics_data_through, entity_id',
    )
    .eq('account_type', 'paid_ads')
    .eq('status', 'connected')
    .eq('scope_status', 'healthy')
    .not('external_account_id', 'is', null)
    .order('account_id', { ascending: true })
    .range(0, 999);
  if (input?.accountId) query = query.eq('account_id', input.accountId);
  const { data: accounts, error } = await query;
  if (error) return { queued: 0, errors: [error.message] };
  let queued = 0;
  const errors: string[] = [];
  for (const account of accounts ?? []) {
    const timezone =
      account.platform === 'linkedin'
        ? 'UTC'
        : String(account.timezone || 'UTC');
    const yesterday = shiftDate(providerToday(timezone), -1);
    const windows: Array<{
      start: string;
      end: string;
      purpose: 'bootstrap_90d' | 'rolling_28d' | 'manual';
    }> = [];
    const rollingWindows: typeof windows = [];
    const purpose =
      input?.source === 'manual' ? 'manual' : 'rolling_28d';
    for (let offset = 0; offset < 28; offset += 7) {
      rollingWindows.push({
        start: shiftDate(yesterday, -(offset + 6)),
        end: shiftDate(yesterday, -offset),
        purpose,
      });
    }
    const historyStart = shiftDate(yesterday, -89);
    const { data: coverage, error: coverageError } = await sb
      .from('os_marketing_paid_sync_days')
      .select('metric_date')
      .eq('ad_account_id', account.account_id)
      .gte('metric_date', historyStart)
      .lte('metric_date', yesterday)
      .range(0, 999);
    if (coverageError) {
      errors.push(`${account.account_id}: ${coverageError.message}`);
      continue;
    }
    const covered = new Set(
      (coverage ?? []).map((day) => String(day.metric_date)),
    );
    let rollingCursor = shiftDate(yesterday, -27);
    let recentCoverageComplete = true;
    while (rollingCursor <= yesterday) {
      if (!covered.has(rollingCursor)) {
        recentCoverageComplete = false;
        break;
      }
      rollingCursor = shiftDate(rollingCursor, 1);
    }
    if (recentCoverageComplete) windows.push(...rollingWindows);
    let gapStart: string | null = null;
    let cursor = historyStart;
    while (cursor <= yesterday) {
      if (!covered.has(cursor) && !gapStart) gapStart = cursor;
      const next = shiftDate(cursor, 1);
      if (gapStart && (covered.has(cursor) || next > yesterday)) {
        let start = gapStart;
        const gapEnd = covered.has(cursor) ? shiftDate(cursor, -1) : cursor;
        while (start <= gapEnd) {
          const end = shiftDate(start, 6) < gapEnd
            ? shiftDate(start, 6)
            : gapEnd;
          windows.push({
            start,
            end,
            purpose: input?.source === 'manual' ? 'manual' : 'bootstrap_90d',
          });
          start = shiftDate(end, 1);
        }
        gapStart = null;
      }
      cursor = next;
    }
    for (const window of windows) {
      const { data: enqueueResult, error: enqueueError } = await sb.rpc(
        'enqueue_marketing_paid_sync_v3',
        {
          p_ad_account_id: account.account_id,
          p_window_start: window.start,
          p_window_end: window.end,
          p_purpose: window.purpose,
          p_trigger_source: input?.source ?? 'cron',
          p_requested_by: input?.requestedBy ?? null,
        },
      );
      if (enqueueError) {
        errors.push(`${account.account_id}: ${enqueueError.message}`);
      } else if (
        (enqueueResult as { created?: boolean } | null)?.created === true
      ) {
        queued += 1;
      }
    }
  }
  return { queued, errors };
}

async function fetchMetaWindow(input: {
  run: SyncRun;
  token: string;
  campaigns: BoundCampaign[];
  heartbeat: () => Promise<void>;
  requestIds: ProviderRequestId[];
}): Promise<{
  rows: MetricRow[];
  accountRows: AccountMetricRow[];
  pages: number;
  providerRequestIds: ProviderRequestId[];
}> {
  const version = process.env.META_API_VERSION?.trim() || 'v25.0';
  const byExternal = new Map(
    input.campaigns.map((campaign) => [
      campaign.external_campaign_id,
      campaign,
    ]),
  );
  const rows: MetricRow[] = [];
  const seenRows = new Set<string>();
  let pages = 0;
  const providerRequestIds = input.requestIds;
  const accountRows: AccountMetricRow[] = [];
  let accountAfter: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    await input.heartbeat();
    const accountParams = new URLSearchParams({
      level: 'account',
      time_increment: '1',
      time_range: JSON.stringify({
        since: input.run.window_start,
        until: input.run.window_end,
      }),
      fields: 'account_id,date_start,date_stop,impressions,clicks,spend',
      limit: '500',
    });
    if (accountAfter) accountParams.set('after', accountAfter);
    const accountResponse = await fetch(
      `https://graph.facebook.com/${version}/${encodeURIComponent(input.run.external_account_id)}/insights?${accountParams.toString()}`,
      {
        headers: { Authorization: `Bearer ${input.token}` },
        signal: AbortSignal.timeout(20_000),
      },
    );
    preserveRequestId(providerRequestIds, {
      scope: 'account',
      provider_object_ids: [input.run.external_account_id],
      request_id: accountResponse.headers.get('x-fb-trace-id'),
    });
    const accountJson = (await accountResponse.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number };
    };
    if (!accountResponse.ok) {
      const classification = classifyPaidFailure({
        status: accountResponse.status,
        code: String(accountJson.error?.code ?? accountResponse.status),
        message:
          accountJson.error?.message ||
          `Meta account insights HTTP ${accountResponse.status}`,
        retryAfter: accountResponse.headers.get('retry-after'),
      });
      const error = new Error(
        accountJson.error?.message ||
          `Meta account insights HTTP ${accountResponse.status}`,
      );
      Object.assign(error, classification, { status: accountResponse.status });
      throw error;
    }
    pages += 1;
    const contracted = parseMetaAccountPage({
      raw: accountJson,
      expectedExternalAccountId: input.run.external_account_id,
      windowStart: input.run.window_start,
      windowEnd: input.run.window_end,
    });
    accountRows.push(...contracted.rows);
    accountAfter = contracted.nextCursor;
    if (!accountAfter) break;
    if (page === 9) {
      throw new PaidProviderInconsistentError(
        'meta_account_page_limit',
        'Meta account insights page limit exceeded',
      );
    }
  }
  for (let offset = 0; offset < input.campaigns.length; offset += 50) {
    const batch = input.campaigns.slice(offset, offset + 50);
    let after: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      await input.heartbeat();
      const params = new URLSearchParams({
        level: 'campaign',
        time_increment: '1',
        time_range: JSON.stringify({
          since: input.run.window_start,
          until: input.run.window_end,
        }),
        fields:
          'campaign_id,date_start,date_stop,impressions,clicks,spend,actions',
        filtering: JSON.stringify([
          {
            field: 'campaign.id',
            operator: 'IN',
            value: batch.map((campaign) => campaign.external_campaign_id),
          },
        ]),
        limit: '500',
      });
      if (after) params.set('after', after);
      const res = await fetch(
        `https://graph.facebook.com/${version}/${encodeURIComponent(input.run.external_account_id)}/insights?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${input.token}` },
          signal: AbortSignal.timeout(20_000),
        },
      );
      preserveRequestId(providerRequestIds, {
        scope: 'campaign',
        provider_object_ids: batch.map(
          (campaign) => campaign.external_campaign_id,
        ),
        request_id: res.headers.get('x-fb-trace-id'),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string; code?: number };
      };
      if (!res.ok) {
        const classification = classifyPaidFailure({
          status: res.status,
          code: String(json.error?.code ?? res.status),
          message: json.error?.message || `Meta insights HTTP ${res.status}`,
          retryAfter: res.headers.get('retry-after'),
        });
        const error = new Error(
          json.error?.message || `Meta insights HTTP ${res.status}`,
        ) as Error & {
          retryable?: boolean;
          code?: string;
          errorClass?: string;
          retryAfterSeconds?: number | null;
          status?: number;
        };
        Object.assign(error, classification, { status: res.status });
        throw error;
      }
      pages += 1;
      const contracted = parseMetaCampaignPage({
        raw: json,
        knownCampaignIds: new Set(byExternal.keys()),
        conversionMetricByCampaign: new Map(
          input.campaigns.map((campaign) => [
            campaign.external_campaign_id,
            campaign.conversion_metric,
          ]),
        ),
        windowStart: input.run.window_start,
        windowEnd: input.run.window_end,
      });
      for (const insight of contracted.rows) {
        const campaign = byExternal.get(insight.external_campaign_id);
        if (!campaign) {
          throw new PaidContractError(
            'meta_campaign_binding_missing',
            'Validated Meta campaign lost its local binding',
          );
        }
        const rowKey = `${campaign.campaign_id}:${insight.metric_date}`;
        if (seenRows.has(rowKey)) {
          throw new PaidContractError(
            'meta_duplicate_across_pages',
            `Meta returned duplicate metric ${rowKey} across pages`,
          );
        }
        seenRows.add(rowKey);
        const base = {
          campaign_id: campaign.campaign_id,
          external_campaign_id: campaign.external_campaign_id,
          metric_date: insight.metric_date,
          impressions: insight.impressions,
          clicks: insight.clicks,
          spend: insight.spend,
          conversions: insight.conversions,
          provider_metrics: {
            conversion_metric: campaign.conversion_metric,
            contract_version: PAID_CONTRACT_VERSION,
          },
        };
        rows.push({ ...base, row_fingerprint: fingerprint(base) });
      }
      after = contracted.nextCursor;
      if (!after) break;
      if (page === 9) {
        throw new PaidProviderInconsistentError(
          'provider_meta_campaign_page_limit',
          'Meta campaign insights page limit exceeded',
        );
      }
    }
  }
  return {
    rows,
    accountRows: reconcileAccountDailyTotals({
      campaignRows: rows,
      providerRows: accountRows,
      windowStart: input.run.window_start,
      windowEnd: input.run.window_end,
      reconcileConversions: false,
    }),
    pages,
    providerRequestIds,
  };
}

async function fetchLinkedInWindow(input: {
  run: SyncRun;
  token: string;
  campaigns: BoundCampaign[];
  heartbeat: () => Promise<void>;
  requestIds: ProviderRequestId[];
}): Promise<{
  rows: MetricRow[];
  accountRows: AccountMetricRow[];
  pages: number;
  providerRequestIds: ProviderRequestId[];
}> {
  const byExternal = new Map(
    input.campaigns.map((campaign) => [
      campaign.external_campaign_id.replace(/^urn:li:sponsoredCampaign:/, ''),
      campaign,
    ]),
  );
  const rows: MetricRow[] = [];
  const providerRequestIds = input.requestIds;
  let pages = 0;
  const seenRows = new Set<string>();
  const accountUrn = input.run.external_account_id.startsWith('urn:')
    ? input.run.external_account_id
    : `urn:li:sponsoredAccount:${input.run.external_account_id}`;
  const accountParams = new URLSearchParams({
    q: 'analytics',
    pivot: 'ACCOUNT',
    timeGranularity: 'DAILY',
    dateRange: `(start:${datePart(input.run.window_start)},end:${datePart(
      input.run.window_end,
    )})`,
    accounts: `List(${accountUrn})`,
    fields:
      'pivotValues,dateRange,impressions,clicks,costInLocalCurrency,externalWebsiteConversions',
  });
  await input.heartbeat();
  const accountResponse = await fetch(
    `https://api.linkedin.com/rest/adAnalytics?${accountParams.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${input.token}`,
        'LinkedIn-Version':
          process.env.LINKEDIN_API_VERSION?.trim() || '202607',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      signal: AbortSignal.timeout(20_000),
    },
  );
  preserveRequestId(providerRequestIds, {
    scope: 'account',
    provider_object_ids: [accountUrn],
    request_id: accountResponse.headers.get('x-li-uuid'),
  });
  const accountJson = (await accountResponse.json().catch(() => ({}))) as {
    message?: string;
  };
  if (!accountResponse.ok) {
    const classification = classifyPaidFailure({
      status: accountResponse.status,
      code: String(accountResponse.status),
      message:
        accountJson.message ||
        `LinkedIn account analytics HTTP ${accountResponse.status}`,
      retryAfter: accountResponse.headers.get('retry-after'),
    });
    const error = new Error(
      accountJson.message ||
        `LinkedIn account analytics HTTP ${accountResponse.status}`,
    );
    Object.assign(error, classification, { status: accountResponse.status });
    throw error;
  }
  pages += 1;
  const accountRows = parseLinkedInAccountPage({
    raw: accountJson,
    expectedExternalAccountId: input.run.external_account_id,
    windowStart: input.run.window_start,
    windowEnd: input.run.window_end,
  }).rows;
  if (accountRows.length === 0) {
    await input.heartbeat();
    const accessResponse = await fetch(
      'https://api.linkedin.com/rest/adAccounts?q=search&count=100',
      {
        headers: {
          Authorization: `Bearer ${input.token}`,
          'LinkedIn-Version':
            process.env.LINKEDIN_API_VERSION?.trim() || '202607',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        signal: AbortSignal.timeout(20_000),
      },
    );
    preserveRequestId(providerRequestIds, {
      scope: 'account_access',
      provider_object_ids: [accountUrn],
      request_id: accessResponse.headers.get('x-li-uuid'),
    });
    const accessJson = (await accessResponse.json().catch(() => ({}))) as {
      elements?: Array<{ id?: number | string }>;
      message?: string;
    };
    if (
      !accessResponse.ok ||
      !linkedinAccountAccessConfirmed(
        accessJson,
        input.run.external_account_id,
      )
    ) {
      throw new PaidAuthorizationAmbiguousError(
        'linkedin_empty_account_access_ambiguous',
        accessJson.message ||
          'LinkedIn returned empty analytics and fresh account access could not be confirmed',
      );
    }
  }
  for (let offset = 0; offset < input.campaigns.length; offset += 25) {
    const batch = input.campaigns.slice(offset, offset + 25);
    const urns = batch.map((campaign) =>
      campaign.external_campaign_id.startsWith('urn:')
        ? campaign.external_campaign_id
        : `urn:li:sponsoredCampaign:${campaign.external_campaign_id}`,
    );
    await input.heartbeat();
    const params = new URLSearchParams({
      q: 'analytics',
      pivot: 'CAMPAIGN',
      timeGranularity: 'DAILY',
      dateRange: `(start:${datePart(input.run.window_start)},end:${datePart(
        input.run.window_end,
      )})`,
      campaigns: `List(${urns.join(',')})`,
      fields:
        'pivotValues,dateRange,impressions,clicks,costInLocalCurrency,externalWebsiteConversions',
    });
    const res = await fetch(
      `https://api.linkedin.com/rest/adAnalytics?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${input.token}`,
          'LinkedIn-Version':
            process.env.LINKEDIN_API_VERSION?.trim() || '202607',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        signal: AbortSignal.timeout(20_000),
      },
    );
    preserveRequestId(providerRequestIds, {
      scope: 'campaign',
      provider_object_ids: urns,
      request_id: res.headers.get('x-li-uuid'),
    });
    const json = (await res.json().catch(() => ({}))) as {
      message?: string;
    };
    if (!res.ok) {
      const classification = classifyPaidFailure({
        status: res.status,
        code: String(res.status),
        message: json.message || `LinkedIn analytics HTTP ${res.status}`,
        retryAfter: res.headers.get('retry-after'),
      });
      const error = new Error(
        json.message || `LinkedIn analytics HTTP ${res.status}`,
      ) as Error & {
        retryable?: boolean;
        code?: string;
        errorClass?: string;
        retryAfterSeconds?: number | null;
        status?: number;
      };
      Object.assign(error, classification, { status: res.status });
      throw error;
    }
    const contracted = parseLinkedInCampaignPage({
      raw: json,
      knownCampaignIds: new Set(byExternal.keys()),
      windowStart: input.run.window_start,
      windowEnd: input.run.window_end,
    });
    for (const insight of contracted.rows) {
      const campaign = byExternal.get(insight.external_campaign_id);
      if (!campaign) {
        throw new PaidContractError(
          'linkedin_campaign_binding_missing',
          'Validated LinkedIn campaign lost its local binding',
        );
      }
      const rowKey = `${campaign.campaign_id}:${insight.metric_date}`;
      if (seenRows.has(rowKey)) {
        throw new PaidContractError(
          'linkedin_duplicate_across_pages',
          `LinkedIn returned duplicate metric ${rowKey} across batches`,
        );
      }
      seenRows.add(rowKey);
      const base = {
        campaign_id: campaign.campaign_id,
        external_campaign_id: campaign.external_campaign_id,
        metric_date: insight.metric_date,
        impressions: insight.impressions,
        clicks: insight.clicks,
        spend: insight.spend,
        conversions: insight.conversions,
        provider_metrics: {
          conversion_definition: 'externalWebsiteConversions',
          contract_version: PAID_CONTRACT_VERSION,
        },
      };
      rows.push({ ...base, row_fingerprint: fingerprint(base) });
    }
    pages += 1;
  }
  return {
    rows,
    accountRows: reconcileAccountDailyTotals({
      campaignRows: rows,
      providerRows: accountRows,
      windowStart: input.run.window_start,
      windowEnd: input.run.window_end,
      reconcileConversions: true,
    }),
    pages,
    providerRequestIds,
  };
}

export async function processPaidMetricRuns(limit = 1): Promise<{
  claimed: number;
  completed: number;
  superseded: number;
  failed: number;
  details: string[];
}> {
  const sb = await createPersistClient();
  const workerId = `paid-${randomUUID()}`;
  const { data, error } = await sb.rpc('claim_marketing_paid_sync_runs', {
    p_worker_id: workerId,
    p_limit: Math.min(Math.max(limit, 1), 5),
    p_lease_seconds: 180,
  });
  if (error) {
    return {
      claimed: 0,
      completed: 0,
      superseded: 0,
      failed: 1,
      details: [error.message],
    };
  }
  const runs = (data ?? []) as SyncRun[];
  let completed = 0;
  let superseded = 0;
  let failed = 0;
  const details: string[] = [];
  for (const run of runs) {
    const providerRequestIds: ProviderRequestId[] = [];
    try {
      const [{ data: campaigns, error: campaignError }, token] =
        await Promise.all([
          sb
            .from('os_marketing_campaigns')
            .select(
              'campaign_id, external_campaign_id, conversion_metric',
            )
            .eq('ad_account_id', run.ad_account_id)
            .eq('channel', 'paid'),
          ensureFreshAccessToken(run.ad_account_id),
        ]);
      if (campaignError) throw new Error(campaignError.message);
      if (!token.token) throw new Error(token.error || 'OAuth token unavailable');
      const bound = (campaigns ?? []).filter(
        (campaign): campaign is BoundCampaign =>
          Boolean(campaign.external_campaign_id),
      );
      if (bound.length === 0 || bound.length > 200) {
        throw new Error('Paid sync requires 1-200 bound campaigns');
      }
      const heartbeat = async () => {
        const { error: heartbeatError } = await sb.rpc(
          'extend_marketing_paid_sync_lease',
          {
            p_run_id: run.run_id,
            p_lease_token: run.lease_token,
            p_lease_seconds: 300,
          },
        );
        if (heartbeatError) throw new Error(heartbeatError.message);
      };
      const result =
        run.provider === 'meta_ads'
          ? await fetchMetaWindow({
              run,
              token: token.token,
              campaigns: bound,
              heartbeat,
              requestIds: providerRequestIds,
            })
          : await fetchLinkedInWindow({
              run,
              token: token.token,
              campaigns: bound,
              heartbeat,
              requestIds: providerRequestIds,
            });
      const responseSha = createHash('sha256')
        .update(
          JSON.stringify({
            campaign_rows: result.rows,
            account_rows: result.accountRows,
          }),
        )
        .digest('hex');
      const mappingGapDays = result.accountRows.filter(
        (row) => row.mapping_status === 'gap',
      ).length;
      const validationEvidence = {
        status: 'passed',
        contract_version: PAID_CONTRACT_VERSION,
        provider: run.provider,
        external_account_id: run.external_account_id,
        window_start: run.window_start,
        window_end: run.window_end,
        page_count: result.pages,
        row_count: result.rows.length,
        account_row_count: result.accountRows.length,
        provider_complete_days: result.accountRows.length,
        mapping_gap_days: mappingGapDays,
        response_sha256: responseSha,
        provider_request_ids: result.providerRequestIds,
      };
      const { data: completion, error: completeError } = await sb.rpc(
        'complete_marketing_paid_sync_run_v3',
        {
          p_run_id: run.run_id,
          p_lease_token: run.lease_token,
          p_rows: result.rows,
          p_account_rows: result.accountRows,
          p_pages_fetched: result.pages,
          p_response_sha256: responseSha,
          p_provider_request_id:
            result.providerRequestIds[0]?.request_id ?? null,
          p_provider_request_ids: result.providerRequestIds,
          p_contract_version: PAID_CONTRACT_VERSION,
          p_validation_evidence: validationEvidence,
        },
      );
      if (completeError) {
        if (
          completeError.message.includes(
            'Provider account totals are inconsistent',
          )
        ) {
          throw new PaidProviderInconsistentError(
            'provider_sql_reconciliation_inconsistent',
            completeError.message,
          );
        }
        if (completeError.message.includes('campaign binding')) {
          throw new PaidContractError(
            'campaign_binding_changed',
            completeError.message,
          );
        }
        throw new Error(completeError.message);
      }
      const completionStatus = String(
        (completion as { status?: string } | null)?.status ?? '',
      );
      if (completionStatus === 'superseded') {
        superseded += 1;
        const { data: replacement, error: replacementError } = await sb.rpc(
          'enqueue_marketing_paid_sync_v3',
          {
            p_ad_account_id: run.ad_account_id,
            p_window_start: run.window_start,
            p_window_end: run.window_end,
            p_purpose: run.purpose,
            p_trigger_source: run.trigger_source,
            p_requested_by: run.requested_by,
          },
        );
        if (replacementError) {
          failed += 1;
          details.push(
            `${run.run_id}: superseded; replacement enqueue failed: ${replacementError.message}`,
          );
        } else {
          details.push(
            `${run.run_id}: superseded; replacement ${String(
              (replacement as { run_id?: string } | null)?.run_id ?? 'queued',
            )}`,
          );
        }
      } else {
        completed += 1;
        const authoritativeHash = String(
          (completion as { evidence_sha256?: string } | null)
            ?.evidence_sha256 ?? '',
        );
        details.push(
          `${run.run_id}: ${result.rows.length} mapped rows · ${mappingGapDays} mapping-gap days · ${authoritativeHash.slice(0, 12)}`,
        );
      }
    } catch (caught) {
      failed += 1;
      const typed = caught as Error & {
        retryable?: boolean;
        code?: string;
        errorClass?: string;
        retryAfterSeconds?: number | null;
        status?: number;
      };
      const message =
        caught instanceof Error ? caught.message : 'Paid sync failed';
      const classification =
        caught instanceof PaidContractError
          ? {
              retryable: caught.retryable,
              code: caught.code,
              errorClass: caught.errorClass,
              retryAfterSeconds: caught.retryable ? 300 : null,
            }
          : typed.errorClass
            ? {
                retryable: Boolean(typed.retryable),
                code: typed.code || 'sync_failed',
                errorClass: typed.errorClass,
                retryAfterSeconds: typed.retryAfterSeconds ?? 300,
              }
            : classifyPaidFailure({
                status: typed.status,
                code: typed.code,
                message,
              });
      const failureEvidence = {
        status: 'failed',
        contract_version: PAID_CONTRACT_VERSION,
        provider: run.provider,
        external_account_id: run.external_account_id,
        code: classification.code,
        error_class: classification.errorClass,
        provider_request_ids: providerRequestIds,
      };
      const { error: failureError } = await sb.rpc(
        'fail_marketing_paid_sync_run_v2',
        {
        p_run_id: run.run_id,
        p_lease_token: run.lease_token,
        p_retryable: classification.retryable,
        p_retry_after_seconds: classification.retryAfterSeconds ?? 300,
        p_error_code: classification.code,
        p_error_detail: message,
          p_error_class: classification.errorClass,
          p_http_status: typed.status ?? null,
          p_validation_evidence: failureEvidence,
        },
      );
      details.push(
        `${run.run_id}: ${message}${
          failureError ? ` · persistence failed: ${failureError.message}` : ''
        }`,
      );
    }
  }
  return { claimed: runs.length, completed, superseded, failed, details };
}

export async function listPaidMetricOperations(input?: {
  entityId?: string | null;
  firmWide?: boolean;
}) {
  const sb = await createPersistClient();
  let runQuery = sb
    .from('os_marketing_paid_sync_runs')
    .select(
      'run_id, ad_account_id, entity_id, provider, window_start, window_end, purpose, status, attempts, pages_fetched, rows_written, provider_complete_days, mapping_gap_days, reconciliation_status, next_attempt_at, error_code, error_detail, error_class, retry_disposition, last_http_status, retry_after_seconds, contract_version, validation_status, validation_evidence_sha256, provider_request_id, provider_request_ids, queued_at, completed_at',
    )
    .order('queued_at', { ascending: false })
    .limit(30);
  let dayQuery = sb
    .from('os_marketing_paid_sync_days')
    .select(
      'ad_account_id, metric_date, entity_id, provider_complete, mapping_status, source_run_id',
    )
    .gte('metric_date', shiftDate(new Date().toISOString().slice(0, 10), -90));
  if (!input?.firmWide) {
    if (!input?.entityId) return { runs: [], coverage: [] };
    runQuery = runQuery.eq('entity_id', input.entityId);
    dayQuery = dayQuery.eq('entity_id', input.entityId);
  }
  const [{ data: runs }, { data: coverage }] = await Promise.all([
    runQuery,
    dayQuery,
  ]);
  return { runs: runs ?? [], coverage: coverage ?? [] };
}

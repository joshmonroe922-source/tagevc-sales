import { createHash, randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { ensureFreshAccessToken } from '@/lib/shared-services/marketing-token-refresh';

type SyncRun = {
  run_id: string;
  ad_account_id: string;
  entity_id: string | null;
  provider: 'meta_ads' | 'linkedin_ads';
  external_account_id: string;
  reporting_timezone: string;
  window_start: string;
  window_end: string;
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
  spend: number;
  conversions: number | null;
  provider_metrics: Record<string, unknown>;
  row_fingerprint: string;
};

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
    .limit(20);
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
    const purpose =
      input?.source === 'manual' ? 'manual' : 'rolling_28d';
    for (let offset = 0; offset < 28; offset += 7) {
      windows.push({
        start: shiftDate(yesterday, -(offset + 6)),
        end: shiftDate(yesterday, -offset),
        purpose,
      });
    }
    if (!account.paid_metrics_data_through) {
      const bootstrapEnd = shiftDate(yesterday, -28);
      let start = shiftDate(yesterday, -90);
      while (start <= bootstrapEnd) {
        const end =
          shiftDate(start, 6) < bootstrapEnd
            ? shiftDate(start, 6)
            : bootstrapEnd;
        windows.push({ start, end, purpose: 'bootstrap_90d' });
        start = shiftDate(end, 1);
      }
    }
    for (const window of windows) {
      const { error: enqueueError } = await sb.rpc(
        'enqueue_marketing_paid_sync',
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
      } else {
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
}): Promise<{ rows: MetricRow[]; pages: number; requestId: string | null }> {
  const version = process.env.META_API_VERSION?.trim() || 'v25.0';
  const byExternal = new Map(
    input.campaigns.map((campaign) => [
      campaign.external_campaign_id,
      campaign,
    ]),
  );
  const rows: MetricRow[] = [];
  let pages = 0;
  let requestId: string | null = null;
  for (let offset = 0; offset < input.campaigns.length; offset += 50) {
    const batch = input.campaigns.slice(offset, offset + 50);
    let after: string | null = null;
    for (let page = 0; page < 10; page += 1) {
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
      requestId ||= res.headers.get('x-fb-trace-id');
      const json = (await res.json().catch(() => ({}))) as {
        data?: Array<{
          campaign_id?: string;
          date_start?: string;
          date_stop?: string;
          impressions?: string;
          clicks?: string;
          spend?: string;
          actions?: Array<{ action_type?: string; value?: string }>;
        }>;
        paging?: { cursors?: { after?: string }; next?: string };
        error?: { message?: string; code?: number };
      };
      if (!res.ok) {
        const error = new Error(
          json.error?.message || `Meta insights HTTP ${res.status}`,
        ) as Error & { retryable?: boolean; code?: string };
        error.retryable = res.status === 429 || res.status >= 500;
        error.code = String(json.error?.code ?? res.status);
        throw error;
      }
      pages += 1;
      for (const insight of json.data ?? []) {
        if (
          !insight.campaign_id ||
          !insight.date_start ||
          insight.date_start !== insight.date_stop
        ) {
          throw new Error('Meta returned a malformed non-daily insight row');
        }
        const campaign = byExternal.get(insight.campaign_id);
        if (!campaign) continue;
        const base = {
          campaign_id: campaign.campaign_id,
          external_campaign_id: campaign.external_campaign_id,
          metric_date: insight.date_start,
          impressions: Number(insight.impressions ?? 0),
          clicks: Number(insight.clicks ?? 0),
          spend: Number(insight.spend ?? 0),
          conversions: campaign.conversion_metric
            ? Number(
                insight.actions?.find(
                  (action) =>
                    action.action_type === campaign.conversion_metric,
                )?.value ?? 0,
              )
            : null,
          provider_metrics: {
            conversion_metric: campaign.conversion_metric,
          },
        };
        rows.push({ ...base, row_fingerprint: fingerprint(base) });
      }
      after = json.paging?.next
        ? json.paging.cursors?.after ?? null
        : null;
      if (!after) break;
      if (page === 9) throw new Error('Meta insights page limit exceeded');
    }
  }
  return { rows, pages, requestId };
}

async function fetchLinkedInWindow(input: {
  run: SyncRun;
  token: string;
  campaigns: BoundCampaign[];
}): Promise<{ rows: MetricRow[]; pages: number; requestId: string | null }> {
  const byExternal = new Map(
    input.campaigns.map((campaign) => [
      campaign.external_campaign_id.replace(/^urn:li:sponsoredCampaign:/, ''),
      campaign,
    ]),
  );
  const rows: MetricRow[] = [];
  let requestId: string | null = null;
  for (let offset = 0; offset < input.campaigns.length; offset += 25) {
    const batch = input.campaigns.slice(offset, offset + 25);
    const urns = batch.map((campaign) =>
      campaign.external_campaign_id.startsWith('urn:')
        ? campaign.external_campaign_id
        : `urn:li:sponsoredCampaign:${campaign.external_campaign_id}`,
    );
    const params = new URLSearchParams({
      q: 'analytics',
      pivot: 'CAMPAIGN',
      timeGranularity: 'DAILY',
      dateRange: `(start:${datePart(input.run.window_start)},end:${datePart(input.run.window_end)})`,
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
    requestId ||= res.headers.get('x-li-uuid');
    const json = (await res.json().catch(() => ({}))) as {
      elements?: Array<{
        pivotValues?: string[];
        dateRange?: {
          start?: { year?: number; month?: number; day?: number };
        };
        impressions?: number;
        clicks?: number;
        costInLocalCurrency?: string | number;
        externalWebsiteConversions?: number;
      }>;
      message?: string;
    };
    if (!res.ok) {
      const error = new Error(
        json.message || `LinkedIn analytics HTTP ${res.status}`,
      ) as Error & { retryable?: boolean; code?: string };
      error.retryable = res.status === 429 || res.status >= 500;
      error.code = String(res.status);
      throw error;
    }
    for (const insight of json.elements ?? []) {
      const externalId =
        insight.pivotValues?.[0]?.match(/(\d+)$/)?.[1] ?? '';
      const campaign = byExternal.get(externalId);
      const date = insight.dateRange?.start;
      if (!campaign || !date?.year || !date.month || !date.day) {
        throw new Error('LinkedIn returned an unknown campaign or date');
      }
      const metricDate = `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
      const base = {
        campaign_id: campaign.campaign_id,
        external_campaign_id: campaign.external_campaign_id,
        metric_date: metricDate,
        impressions: Number(insight.impressions ?? 0),
        clicks: Number(insight.clicks ?? 0),
        spend: Number(insight.costInLocalCurrency ?? 0),
        conversions: Number(insight.externalWebsiteConversions ?? 0),
        provider_metrics: {
          conversion_definition: 'externalWebsiteConversions',
        },
      };
      rows.push({ ...base, row_fingerprint: fingerprint(base) });
    }
  }
  return {
    rows,
    pages: Math.ceil(input.campaigns.length / 25),
    requestId,
  };
}

export async function processPaidMetricRuns(limit = 2): Promise<{
  claimed: number;
  completed: number;
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
    return { claimed: 0, completed: 0, failed: 1, details: [error.message] };
  }
  const runs = (data ?? []) as SyncRun[];
  let completed = 0;
  let failed = 0;
  const details: string[] = [];
  for (const run of runs) {
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
      const result =
        run.provider === 'meta_ads'
          ? await fetchMetaWindow({ run, token: token.token, campaigns: bound })
          : await fetchLinkedInWindow({
              run,
              token: token.token,
              campaigns: bound,
            });
      const responseSha = createHash('sha256')
        .update(JSON.stringify(result.rows))
        .digest('hex');
      const { error: completeError } = await sb.rpc(
        'complete_marketing_paid_sync_run',
        {
          p_run_id: run.run_id,
          p_lease_token: run.lease_token,
          p_rows: result.rows,
          p_pages_fetched: result.pages,
          p_response_sha256: responseSha,
          p_provider_request_id: result.requestId,
        },
      );
      if (completeError) throw new Error(completeError.message);
      completed += 1;
      details.push(`${run.run_id}: ${result.rows.length} rows`);
    } catch (caught) {
      failed += 1;
      const typed = caught as Error & { retryable?: boolean; code?: string };
      const message =
        caught instanceof Error ? caught.message : 'Paid sync failed';
      await sb.rpc('fail_marketing_paid_sync_run', {
        p_run_id: run.run_id,
        p_lease_token: run.lease_token,
        p_retryable: Boolean(typed.retryable),
        p_retry_after_seconds: typed.retryable ? 900 : 300,
        p_error_code: typed.code || 'sync_failed',
        p_error_detail: message,
      });
      details.push(`${run.run_id}: ${message}`);
    }
  }
  return { claimed: runs.length, completed, failed, details };
}

export async function listPaidMetricOperations(input?: {
  entityId?: string | null;
  firmWide?: boolean;
}) {
  const sb = await createPersistClient();
  let runQuery = sb
    .from('os_marketing_paid_sync_runs')
    .select(
      'run_id, ad_account_id, entity_id, provider, window_start, window_end, purpose, status, attempts, pages_fetched, rows_written, next_attempt_at, error_code, error_detail, queued_at, completed_at',
    )
    .order('queued_at', { ascending: false })
    .limit(30);
  let dayQuery = sb
    .from('os_marketing_paid_sync_days')
    .select('ad_account_id, metric_date, entity_id')
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

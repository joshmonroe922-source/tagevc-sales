'use client';

import {
  useActionState,
  useState,
  useTransition,
  type FormEvent,
} from 'react';
import {
  approveContentAction,
  createCampaignAction,
  createContentAction,
  generateDraftAction,
  pullEngagementAction,
  queuePaidMetricsBackfillAction,
  recordPaidRevenueEvidenceAction,
  retryPaidMetricsRunAction,
  recordEngagementAction,
  refreshTokensAction,
  registerAccountAction,
  runApprovalSlaDigestAction,
  runScheduleWorkerAction,
  scheduleContentAction,
  stubConnectAccountAction,
  connectBlogAccountAction,
  submitForReviewAction,
  syncPaidCampaignAction,
  upsertBrandVoiceAction,
  type MarketingActionResult,
} from '@/app/(app)/shared-services/marketing/actions';
import { CompanySelect } from '@/components/shared/company-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { entityLabelOrFirm } from '@/lib/entities/display-name';
import type { BrandVoice } from '@/lib/shared-services/marketing-brand';
import type { MarketingAnalyticsSummary } from '@/lib/shared-services/marketing-analytics';
import type { PaidAttributionReport } from '@/lib/shared-services/marketing-attribution';
import type {
  MarketingCampaign,
  MarketingContent,
  MarketingGenerationJob,
  MarketingScheduleJob,
  MarketingSocialAccount,
} from '@/lib/shared-services/marketing-types';

function Msg({ state }: { state: MarketingActionResult | null }) {
  if (!state) return null;
  if (state.ok) {
    return <p className="text-sm text-emerald-700">{state.message ?? 'Done'}</p>;
  }
  return <p className="text-sm text-destructive">{state.error}</p>;
}

const field =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

function formatMicros(value: string, currency: string): string {
  const scale = BigInt(1_000_000);
  const micros = BigInt(value);
  const whole = micros / scale;
  const fraction = (micros % scale).toString().padStart(6, '0');
  return `${currency} ${whole.toLocaleString()}.${fraction.slice(0, 2)}`;
}

/** Platforms with OAuth routes (keep in sync with marketing-oauth OAUTH_PLATFORMS). */
const OAUTH_SET = new Set([
  'linkedin',
  'x',
  'facebook',
  'instagram',
  'youtube',
  'tiktok',
]);

export function MarketingClient({
  campaigns,
  content,
  accounts,
  scheduleJobs,
  generationJobs,
  brandVoices,
  analytics,
  paidOperations,
  attribution,
  analyticsError,
  canWrite,
  tableError,
  foundation,
}: {
  campaigns: MarketingCampaign[];
  content: MarketingContent[];
  accounts: MarketingSocialAccount[];
  scheduleJobs: MarketingScheduleJob[];
  generationJobs: MarketingGenerationJob[];
  brandVoices: BrandVoice[];
  analytics: MarketingAnalyticsSummary;
  attribution: PaidAttributionReport;
  paidOperations: {
    runs: Array<{
      run_id: string;
      ad_account_id: string;
      provider: string;
      window_start: string;
      window_end: string;
      purpose: string;
      status: string;
      attempts: number;
      rows_written: number;
      provider_complete_days?: number;
      mapping_gap_days?: number;
      reconciliation_status?: string | null;
      error_code: string | null;
      error_detail: string | null;
      error_class?: string | null;
      retry_disposition?: string | null;
      last_http_status?: number | null;
      retry_after_seconds?: number | null;
      contract_version?: string | null;
      validation_status?: string | null;
      validation_evidence_sha256?: string | null;
      provider_request_id?: string | null;
      provider_request_ids?: Array<{
        scope: string;
        provider_object_ids: string[];
        request_id: string;
      }>;
    }>;
    coverage: Array<{
      ad_account_id: string;
      metric_date: string;
      provider_complete?: boolean;
      mapping_status?: string;
      source_run_id?: string;
    }>;
  };
  analyticsError?: string;
  canWrite: boolean;
  tableError?: string;
  foundation: {
    ai_provider: string;
    scheduler_enabled: boolean;
    oauth_tokens_stored: boolean;
    linkedin_oauth?: boolean;
    x_oauth?: boolean;
    facebook_oauth?: boolean;
    instagram_oauth?: boolean;
    youtube_oauth?: boolean;
    tiktok_oauth?: boolean;
    linkedin_marketing_api?: boolean;
    youtube_analytics?: boolean;
    tiktok_analytics?: boolean;
    approval_sla_hours?: number;
    sla_assignee?: string | null;
    paid_ads_live?: boolean;
    tiktok_publish?: boolean;
    blog_publish_webhook?: boolean;
    phase: number;
  };
}) {
  const [campState, campAction, campPending] = useActionState(
    createCampaignAction,
    null as MarketingActionResult | null,
  );
  const [contentState, contentAction, contentPending] = useActionState(
    createContentAction,
    null as MarketingActionResult | null,
  );
  const [acctState, acctAction, acctPending] = useActionState(
    registerAccountAction,
    null as MarketingActionResult | null,
  );
  const [genState, genAction, genPending] = useActionState(
    generateDraftAction,
    null as MarketingActionResult | null,
  );
  const [voiceState, voiceAction, voicePending] = useActionState(
    upsertBrandVoiceAction,
    null as MarketingActionResult | null,
  );
  const [revenueState, revenueAction, revenuePending] = useActionState(
    recordPaidRevenueEvidenceAction,
    null as MarketingActionResult | null,
  );
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tiktokUpload, setTikTokUpload] = useState({
    busy: false,
    progress: 0,
    message: null as string | null,
  });
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<MarketingActionResult>) {
    setFlash(null);
    setErr(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) setFlash(res.message ?? 'Done');
      else setErr(res.error);
    });
  }

  async function discoverAdAccount(accountId: string) {
    setFlash(null);
    setErr(null);
    const res = await fetch(
      `/api/marketing/ad-accounts?account_id=${encodeURIComponent(accountId)}`,
    );
    const json = (await res.json()) as {
      error?: string;
      accounts?: Array<{
        externalAccountId: string;
        name: string;
        currency: string | null;
        role: string | null;
      }>;
    };
    if (!res.ok || !json.accounts) {
      setErr(json.error || 'Provider account discovery failed');
      return;
    }
    const listing = json.accounts
      .map(
        (account) =>
          `${account.externalAccountId} — ${account.name}${
            account.currency ? ` (${account.currency})` : ''
          }`,
      )
      .join('\n');
    const selectedId = window.prompt(
      `Select a discovered provider account by ID:\n\n${listing}`,
      json.accounts[0]?.externalAccountId ?? '',
    );
    if (!selectedId) return;
    const selectRes = await fetch('/api/marketing/ad-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: accountId,
        external_account_id: selectedId.trim(),
      }),
    });
    const selected = (await selectRes.json()) as {
      error?: string;
      selected?: { name?: string };
    };
    if (!selectRes.ok) {
      setErr(selected.error || 'Provider account selection failed');
      return;
    }
    setFlash(`Connected ${selected.selected?.name ?? selectedId}`);
    window.location.reload();
  }

  async function uploadTikTokVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get('video_file');
    if (!(file instanceof File) || file.size === 0) return;
    setTikTokUpload({ busy: true, progress: 0, message: 'Initializing…' });
    let uploadId: string | null = null;
    let uploadedBytes = 0;
    try {
      const initRes = await fetch('/api/marketing/tiktok/uploads/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: String(form.get('account_id') ?? ''),
          content_id: String(form.get('content_id') ?? ''),
          media_name: file.name,
          media_type: file.type,
          media_size: file.size,
          privacy_level: String(form.get('privacy_level') ?? ''),
          disable_comment: form.get('disable_comment') === 'on',
          disable_duet: form.get('disable_duet') === 'on',
          disable_stitch: form.get('disable_stitch') === 'on',
        }),
      });
      const init = (await initRes.json()) as {
        error?: string;
        upload_id?: string;
        upload_url?: string;
        chunk_size?: number;
      };
      if (!initRes.ok || !init.upload_id || !init.upload_url || !init.chunk_size) {
        throw new Error(init.error || 'TikTok upload initialization failed');
      }
      uploadId = init.upload_id;
      for (let start = 0; start < file.size; start += init.chunk_size) {
        const endExclusive = Math.min(start + init.chunk_size, file.size);
        let uploadStatus = 0;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const uploadRes = await fetch(init.upload_url, {
            method: 'PUT',
            headers: {
              'Content-Type': file.type,
              'Content-Range': `bytes ${start}-${endExclusive - 1}/${file.size}`,
            },
            body: file.slice(start, endExclusive),
          });
          uploadStatus = uploadRes.status;
          if ([201, 206].includes(uploadStatus)) break;
          if (uploadStatus < 500 || attempt === 2) break;
          await new Promise((resolve) =>
            window.setTimeout(resolve, 500 * 2 ** attempt),
          );
        }
        if (![201, 206].includes(uploadStatus)) {
          throw new Error(`TikTok chunk upload HTTP ${uploadStatus}`);
        }
        uploadedBytes = endExclusive;
        const final = uploadedBytes === file.size;
        const progressRes = await fetch(
          `/api/marketing/tiktok/uploads/${encodeURIComponent(uploadId)}/progress`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              uploaded_bytes: uploadedBytes,
              status: final ? 'uploaded' : 'uploading',
            }),
          },
        );
        const progressJson = (await progressRes.json()) as {
          error?: string;
          job_id?: string;
        };
        if (!progressRes.ok) {
          throw new Error(progressJson.error || 'Progress persistence failed');
        }
        const percent = Math.round((uploadedBytes / file.size) * 100);
        setTikTokUpload({
          busy: !final,
          progress: percent,
          message: final
            ? `Uploaded · processing job ${progressJson.job_id ?? 'queued'}`
            : `Uploaded ${percent}%`,
        });
      }
    } catch (error) {
      if (uploadId) {
        await fetch(
          `/api/marketing/tiktok/uploads/${encodeURIComponent(uploadId)}/progress`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              uploaded_bytes: uploadedBytes,
              status: 'failed',
              error: error instanceof Error ? error.message : 'Upload failed',
            }),
          },
        ).catch(() => undefined);
      }
      setTikTokUpload({
        busy: false,
        progress: 0,
        message: error instanceof Error ? error.message : 'Upload failed',
      });
    }
  }

  const pendingJobs = scheduleJobs.filter((j) => j.status === 'pending');
  const platformEntries = Object.entries(analytics.by_platform).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        Ops strip · Phase {foundation.phase} · AI:{' '}
        <span className="font-medium text-foreground">{foundation.ai_provider}</span>
        {' · '}
        Scheduler:{' '}
        {foundation.scheduler_enabled ? 'enabled' : 'manual/force'}
        {' · '}
        Token vault:{' '}
        {foundation.oauth_tokens_stored ? 'ready' : 'set MARKETING_TOKEN_SECRET'}
        {' · '}
        LI:{foundation.linkedin_oauth ? 'oauth' : 'stub'}
        {foundation.linkedin_marketing_api ? '+mkt' : ''} · X:
        {foundation.x_oauth ? 'oauth' : 'stub'} · Meta:
        {foundation.facebook_oauth || foundation.instagram_oauth
          ? 'oauth'
          : 'stub'}{' '}
        · YT:{foundation.youtube_oauth ? 'oauth' : 'stub'}
        {foundation.youtube_analytics ? '+an' : ''} · TT:
        {foundation.tiktok_oauth ? 'oauth' : foundation.tiktok_analytics ? 'an' : 'off'}
        {foundation.tiktok_publish ? '+pub' : ''}
        {foundation.blog_publish_webhook ? ' · blog:LIVE' : ' · blog:scaffold'}
        {foundation.paid_ads_live ? ' · paid:live' : ' · paid:stub'}
        {foundation.approval_sla_hours
          ? ` · SLA ${foundation.approval_sla_hours}h`
          : ''}
        {foundation.sla_assignee ? ` → ${foundation.sla_assignee}` : ''}
      </div>

      <p className="text-xs text-muted-foreground">
        Campaigns, AI drafts, paid sync, and queues below are advanced ops —
        day-to-day connect + publish lives in the Publish desk at the top.
      </p>

      {tableError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Tables unavailable — apply phase22–24 marketing SQL. {tableError}
        </p>
      )}
      {(flash || err) && (
        <p className={`text-sm ${err ? 'text-destructive' : 'text-emerald-700'}`}>
          {err ?? flash}
        </p>
      )}

      <section
        id="mkt-analytics"
        className="scroll-mt-20 space-y-3 rounded-lg border p-4"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Analytics</h2>
          {analyticsError ? (
            <span className="text-xs text-amber-700">
              Apply phase24_maturation.sql · {analyticsError}
            </span>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Posts succeeded</p>
            <p className="text-lg font-semibold tabular-nums">
              {analytics.posts_succeeded}
              {analytics.posts_stub > 0 ? (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  ({analytics.posts_stub} stub)
                </span>
              ) : null}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Posts failed</p>
            <p className="text-lg font-semibold tabular-nums">
              {analytics.posts_failed}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Impressions / eng. rate</p>
            <p className="text-lg font-semibold tabular-nums">
              {analytics.engagement_impressions}
              {analytics.engagement_rate != null ? (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  ({(analytics.engagement_rate * 100).toFixed(1)}%)
                </span>
              ) : null}
            </p>
            <p className="text-xs text-muted-foreground">
              likes {analytics.engagement_likes} · comments{' '}
              {analytics.engagement_comments ?? 0} · shares{' '}
              {analytics.engagement_shares ?? 0} · API{' '}
              {analytics.engagement_api ?? 0}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Pending schedule</p>
            <p className="text-lg font-semibold tabular-nums">
              {pendingJobs.length}
            </p>
          </div>
        </div>
        <div className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Paid spend</p>
            <p className="font-semibold tabular-nums">
              {analytics.paid_currency_mixed ||
              analytics.paid_spend_k == null
                ? 'grouped below'
                : `$${analytics.paid_spend_k.toFixed(1)}k`}
            </p>
            <p className="text-xs text-muted-foreground">
              {analytics.paid_currencies.join(', ') || 'currency pending'}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Attributed revenue</p>
            <p className="font-semibold tabular-nums">
              {analytics.paid_typed
                ? 'not period-aligned'
                : analytics.paid_currency_mixed
                ? 'grouped below'
                : `$${analytics.paid_revenue_k.toFixed(1)}k`}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">ROI / ROAS</p>
            <p className="font-semibold tabular-nums">
              {analytics.paid_roi == null
                ? analytics.paid_currency_mixed
                  ? 'mixed currencies'
                  : '—'
                : `${(analytics.paid_roi * 100).toFixed(1)}%`}
              {' / '}
              {analytics.paid_roas == null
                ? '—'
                : `${analytics.paid_roas.toFixed(2)}x`}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Paid CTR</p>
            <p className="font-semibold tabular-nums">
              {analytics.paid_ctr == null
                ? '—'
                : `${(analytics.paid_ctr * 100).toFixed(2)}%`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {analytics.paid_typed ? 'Typed daily metrics' : 'Legacy snapshots'} ·{' '}
            data through {analytics.paid_data_through ?? 'pending'} · coverage{' '}
            {analytics.paid_coverage_status} ({analytics.paid_coverage_days}/
            {analytics.paid_reporting_days})
          </span>
          <span className="flex gap-2">
            {[7, 30, 90].map((days) => (
              <a
                key={days}
                href={`/shared-services/marketing?paid_days=${days}`}
                className={
                  analytics.paid_reporting_days === days
                    ? 'font-semibold text-foreground'
                    : 'hover:text-foreground'
                }
              >
                {days}d
              </a>
            ))}
          </span>
        </div>
        {analytics.paid_account_coverage.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {analytics.paid_account_coverage.map((account) => (
              <div
                key={account.account_id}
                className="rounded-md border p-2 text-xs"
              >
                <p className="font-medium">
                  {account.display_name || account.account_id}
                </p>
                <p className="text-muted-foreground">
                  {entityLabelOrFirm(account.entity_id)} · {account.currency} ·{' '}
                  {account.coverage_status} {account.covered_days}/
                  {account.expected_days}
                </p>
                <p className="text-muted-foreground">
                  through {account.latest_covered_date ?? 'pending'}
                  {account.mapping_gap_days > 0
                    ? ` · ${account.mapping_gap_days} mapping-gap day${
                        account.mapping_gap_days === 1 ? '' : 's'
                      }`
                    : ' · fully mapped'}
                </p>
                <p className="text-muted-foreground">
                  mapped {account.mapping_complete_days}/{account.covered_days}{' '}
                  days · authoritative ${Number(
                    account.authoritative_spend,
                  ).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}{' '}
                  / allocation ${Number(account.mapped_spend).toLocaleString(
                    undefined,
                    { maximumFractionDigits: 2 },
                  )} · delta ${Number(account.delta_spend).toLocaleString(
                    undefined,
                    { maximumFractionDigits: 2 },
                  )}
                </p>
              </div>
            ))}
          </div>
        ) : null}
        {analytics.paid_currency_totals.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Currency-safe totals:{' '}
            {analytics.paid_currency_totals
              .map(
                (total) =>
                  `${total.currency} ${Number(total.spend).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })} · ${Number(total.impressions).toLocaleString()} impressions`,
              )
              .join(' | ')}
          </p>
        ) : null}
        {!analytics.paid_currency_mixed &&
        analytics.paid_daily_trend.length > 0 ? (
          <div className="overflow-x-auto">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Daily performance
            </p>
            <div className="flex min-w-max gap-2">
              {analytics.paid_daily_trend.slice(-14).map((day) => (
                <div
                  className="min-w-24 rounded border px-2 py-1 text-xs"
                  key={day.day}
                >
                  <p className="font-medium">{day.day.slice(5)}</p>
                  <p>${day.spend.toFixed(2)} spend</p>
                  <p>{day.clicks} clicks</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium">
              Revenue reconciliation · settlement lag
            </p>
            <p className="text-xs text-muted-foreground">
              {attribution.coverage_status} · {attribution.current_evidence_count}{' '}
              current · {attribution.late_revision_count} revision
              {attribution.late_revision_count === 1 ? '' : 's'}
              {attribution.unverified_current_count > 0
                ? ` · ${attribution.unverified_current_count} legacy/unverified excluded`
                : ''}
              {attribution.currency_groups_truncated ||
              attribution.campaign_groups_truncated
                ? ` · detail capped (${attribution.currency_group_count} currencies / ${attribution.campaign_group_count} campaign groups)`
                : ''}
            </p>
          </div>
          {attribution.currencies.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {attribution.currencies.map((currency) => (
                <div
                  className="rounded border p-2 text-xs"
                  key={currency.currency}
                >
                  <p className="font-medium">{currency.currency}</p>
                  <p>
                    attributed{' '}
                    {formatMicros(
                      currency.attributed_amount_micros,
                      currency.currency,
                    )}
                  </p>
                  <p>
                    settled{' '}
                    {formatMicros(
                      currency.settled_amount_micros,
                      currency.currency,
                    )}
                  </p>
                  <p className="text-muted-foreground">
                    {currency.overdue_count} overdue ·{' '}
                    {currency.settled_late_count} settled late
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No authoritative revenue evidence in this reporting window.
            </p>
          )}
          {attribution.lag.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Lag status:{' '}
              {attribution.lag
                .map(
                  (lag) =>
                    `${lag.lag_status} ${lag.evidence_count}${
                      lag.max_lag_days == null
                        ? ''
                        : ` (max ${lag.max_lag_days}d)`
                    }`,
                )
                .join(' · ')}
            </p>
          ) : null}
          {attribution.campaigns.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1 pr-2">Campaign / provider</th>
                    <th className="py-1 pr-2">Attribution contract</th>
                    <th className="py-1 pr-2">Revenue / settled</th>
                    <th className="py-1">Lag impact</th>
                  </tr>
                </thead>
                <tbody>
                  {attribution.campaigns.map((campaign) => (
                    <tr
                      className="border-b border-border/40"
                      key={`${campaign.campaign_id}:${campaign.currency}:${campaign.attribution_model}:${campaign.attribution_model_version}:${campaign.attribution_window_days}`}
                    >
                      <td className="py-1 pr-2">
                        {campaign.campaign_id} · {campaign.provider}
                      </td>
                      <td className="py-1 pr-2">
                        {campaign.attribution_model} /{' '}
                        {campaign.attribution_model_version} ·{' '}
                        {campaign.attribution_window_days}d
                      </td>
                      <td className="py-1 pr-2">
                        {formatMicros(
                          campaign.attributed_amount_micros,
                          campaign.currency,
                        )}{' '}
                        /{' '}
                        {formatMicros(
                          campaign.settled_amount_micros,
                          campaign.currency,
                        )}
                      </td>
                      <td className="py-1">
                        {campaign.overdue_count} overdue
                        {campaign.max_lag_days == null
                          ? ''
                          : ` · max ${campaign.max_lag_days}d`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
        {canWrite ? (
          <form action={revenueAction} className="space-y-2 rounded-md border p-3">
            <p className="text-xs font-medium">
              Record authoritative revenue evidence
            </p>
            <p className="text-xs text-muted-foreground">
              Append-only. Corrections require the prior evidence UUID and next
              revision number.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <select name="campaign_id" className={field} required defaultValue="">
                <option value="">Paid campaign</option>
                {campaigns
                  .filter(
                    (campaign) =>
                      campaign.channel === 'paid' &&
                      Boolean(campaign.entity_id) &&
                      Boolean(campaign.ad_account_id) &&
                      Boolean(campaign.external_campaign_id),
                  )
                  .map((campaign) => (
                    <option value={campaign.campaign_id} key={campaign.campaign_id}>
                      {campaign.name} · {entityLabelOrFirm(campaign.entity_id)}
                    </option>
                  ))}
              </select>
              <Input
                name="revenue_event_id"
                required
                placeholder="Revenue event ID"
              />
              <Input
                name="revenue_occurred_at"
                required
                placeholder="Revenue ISO timestamp"
              />
              <Input name="attributed_amount" required placeholder="Amount 0.000000" />
              <Input name="settled_amount" required defaultValue="0" />
              <select
                name="settlement_status"
                className={field}
                required
                defaultValue="pending"
              >
                <option value="pending">Pending</option>
                <option value="partial">Partial</option>
                <option value="settled">Settled</option>
                <option value="reversed">Reversed</option>
              </select>
              <Input
                name="expected_settlement_at"
                required
                placeholder="Expected settlement ISO"
              />
              <Input name="settled_at" placeholder="Settled ISO (if settled)" />
              <select
                name="attribution_model"
                className={field}
                required
                defaultValue="last_touch"
              >
                <option value="first_touch">First touch</option>
                <option value="last_touch">Last touch</option>
                <option value="linear">Linear</option>
                <option value="position_based">Position based</option>
                <option value="provider_reported">Provider reported</option>
              </select>
              <Input
                name="attribution_window_days"
                type="number"
                min={1}
                max={90}
                required
                defaultValue={30}
              />
              <Input
                name="attribution_model_version"
                required
                placeholder="Model version"
              />
              <Input name="source_system" required placeholder="Ledger / processor" />
              <Input name="source_record_id" required placeholder="Source record ID" />
              <Input
                name="source_recorded_at"
                required
                placeholder="Source recorded ISO"
              />
              <textarea
                name="source_payload_json"
                required
                maxLength={16384}
                rows={2}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder='Canonical source JSON, e.g. {"invoice_id":"inv_1"}'
              />
              <Input
                name="revision"
                type="number"
                min={1}
                max={10000}
                required
                defaultValue={1}
              />
              <Input
                name="supersedes_evidence_id"
                placeholder="Prior evidence UUID (revision > 1)"
              />
            </div>
            <Button type="submit" size="sm" disabled={revenuePending}>
              Record evidence
            </Button>
            <Msg state={revenueState} />
          </form>
        ) : null}
        {paidOperations.runs.length > 0 ? (
          <div className="space-y-1 rounded-md border p-3 text-xs">
            <p className="font-medium">Paid metrics operations</p>
            {paidOperations.runs.slice(0, 8).map((syncRun) => {
              const covered = new Set(
                paidOperations.coverage
                  .filter(
                    (day) =>
                      day.ad_account_id === syncRun.ad_account_id &&
                      day.provider_complete !== false,
                  )
                  .map((day) => day.metric_date),
              ).size;
              return (
                <div
                  className="flex flex-wrap justify-between gap-2 border-t pt-1"
                  key={syncRun.run_id}
                >
                  <span>
                    {syncRun.provider} · {syncRun.window_start}–
                    {syncRun.window_end} · {syncRun.purpose}
                  </span>
                  <span>
                    {syncRun.status} · attempt {syncRun.attempts} ·{' '}
                    {syncRun.rows_written} rows · {covered}/90 covered
                    {syncRun.reconciliation_status
                      ? ` · reconciliation ${syncRun.reconciliation_status}`
                      : ''}
                    {syncRun.mapping_gap_days
                      ? ` · ${syncRun.mapping_gap_days} gap days`
                      : ''}
                    {syncRun.error_code ? ` · ${syncRun.error_code}` : ''}
                    {syncRun.error_class ? ` · ${syncRun.error_class}` : ''}
                    {syncRun.validation_status
                      ? ` · contract ${syncRun.validation_status}`
                      : ''}
                    {syncRun.validation_evidence_sha256
                      ? ` · evidence ${syncRun.validation_evidence_sha256.slice(0, 12)}…`
                      : ''}
                  </span>
                  {canWrite &&
                  syncRun.status === 'failed' &&
                  syncRun.retry_disposition === 'manual_after_correction' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        const reason = window.prompt(
                          'Describe the corrected OAuth/configuration condition:',
                        );
                        if (!reason?.trim()) return;
                        run(() =>
                          retryPaidMetricsRunAction(
                            syncRun.run_id,
                            reason.trim(),
                          ),
                        );
                      }}
                    >
                      Governed retry
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {analytics.paid_campaigns.length > 0 ? (
          <div className="overflow-x-auto">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Campaign allocation detail (not authoritative account totals)
            </p>
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1 pr-2">Campaign / entity</th>
                  <th className="py-1 pr-2">Platform</th>
                  <th className="py-1 pr-2">Impr. / clicks</th>
                  <th className="py-1 pr-2">Spend</th>
                  <th className="py-1 pr-2">Efficiency</th>
                  <th className="py-1">ROI / budget</th>
                </tr>
              </thead>
              <tbody>
                {analytics.paid_campaigns.map((p) => (
                  <tr
                    key={`${p.campaign_id}:${p.platform}`}
                    className="border-b border-border/40"
                  >
                    <td className="py-1 pr-2">
                      <span className="font-medium">
                        {p.campaign_name ?? p.campaign_id}
                      </span>
                      <span className="block font-mono text-[10px] text-muted-foreground">
                        {p.campaign_id} · {entityLabelOrFirm(p.entity_id)}
                      </span>
                    </td>
                    <td className="py-1 pr-2">{p.platform}</td>
                    <td className="py-1 pr-2 tabular-nums">
                      {p.impressions} / {p.clicks}
                    </td>
                    <td className="py-1 pr-2 tabular-nums">
                      ${p.spend_k.toFixed(1)}k {p.currency}
                    </td>
                    <td className="py-1 pr-2 tabular-nums">
                      CPC {p.cpc == null ? '—' : p.cpc.toFixed(2)} · CPM{' '}
                      {p.cpm == null ? '—' : p.cpm.toFixed(2)}
                    </td>
                    <td className="py-1 tabular-nums">
                      {p.roi == null ? '—' : `${(p.roi * 100).toFixed(1)}%`}
                      {' · '}
                      {p.budget_utilization == null
                        ? '—'
                        : `${(p.budget_utilization * 100).toFixed(0)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {analytics.trend_7d && analytics.trend_7d.length > 0 ? (
          <div className="overflow-x-auto">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              7-day trend
            </p>
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1 pr-2">Day</th>
                  <th className="py-1 pr-2">Posts</th>
                  <th className="py-1 pr-2">Eng. events</th>
                  <th className="py-1">Impressions</th>
                </tr>
              </thead>
              <tbody>
                {analytics.trend_7d.map((t) => (
                  <tr key={t.day} className="border-b border-border/40">
                    <td className="py-1 pr-2 font-mono">{t.day.slice(5)}</td>
                    <td className="py-1 pr-2 tabular-nums">{t.posts}</td>
                    <td className="py-1 pr-2 tabular-nums">
                      {t.engagement_events}
                    </td>
                    <td className="py-1 tabular-nums">{t.impressions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {analytics.platform_rank && analytics.platform_rank.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Platform comparison (by impressions)
            </p>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {analytics.platform_rank.map((p, i) => (
                <li key={p.platform}>
                  #{i + 1} {p.platform} · {p.impressions} impr.
                  {p.engagement_rate != null
                    ? ` · ${(p.engagement_rate * 100).toFixed(1)}% rate`
                    : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : analytics.engagement_by_platform &&
          Object.keys(analytics.engagement_by_platform).length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Engagement by platform:{' '}
            {Object.entries(analytics.engagement_by_platform)
              .map(
                ([p, m]) =>
                  `${p} ${m.impressions}i/${m.likes}♥`,
              )
              .join(' · ')}
          </p>
        ) : null}
        {platformEntries.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            By platform:{' '}
            {platformEntries.map(([p, n]) => `${p} ${n}`).join(' · ')}
          </p>
        ) : null}
        {analytics.recent.length > 0 ? (
          <ul className="max-h-40 overflow-y-auto space-y-1 text-xs text-muted-foreground">
            {analytics.recent.slice(0, 12).map((e) => (
              <li key={e.event_id}>
                {e.occurred_at.slice(0, 16).replace('T', ' ')} · {e.kind}
                {e.platform ? ` · ${e.platform}` : ''}
                {e.content_id ? ` · ${e.content_id}` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No analytics events yet — run the schedule worker or record engagement.
          </p>
        )}
      </section>

      {canWrite && (
        <div className="grid gap-4 lg:grid-cols-2">
          <form action={campAction} className="space-y-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">New campaign</h2>
            <div className="space-y-1">
              <Label htmlFor="camp_name">Name</Label>
              <Input id="camp_name" name="name" required placeholder="Q3 brand push" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="camp_entity">Company (blank = firm-wide)</Label>
              <CompanySelect
                id="camp_entity"
                name="entity_id"
                allowAll
                allLabel="Firm-wide"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="camp_obj">Objective</Label>
              <Input id="camp_obj" name="objective" placeholder="Awareness · leads" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="camp_channel">Channel</Label>
                <select
                  id="camp_channel"
                  name="channel"
                  className={field}
                  defaultValue="organic"
                >
                  <option value="organic">Organic</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="camp_budget">Budget ($k, paid)</Label>
                <Input id="camp_budget" name="budget_k" type="number" step="0.1" />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="camp_conversion">
                Provider conversion metric (optional)
              </Label>
              <Input
                id="camp_conversion"
                name="conversion_metric"
                placeholder="Meta action type, e.g. lead"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="camp_ad">Ad platform</Label>
              <select id="camp_ad" name="ad_platform" className={field} defaultValue="">
                <option value="">Organic / none</option>
                <option value="linkedin_ads">LinkedIn Ads</option>
                <option value="meta_ads">Meta Ads</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="camp_ad_account">Connected ad account</Label>
              <select
                id="camp_ad_account"
                name="ad_account_id"
                className={field}
                defaultValue=""
              >
                <option value="">Select for paid campaigns</option>
                {accounts
                  .filter(
                    (account) =>
                      account.account_type === 'paid_ads' &&
                      account.status === 'connected',
                  )
                  .map((account) => (
                    <option value={account.account_id} key={account.account_id}>
                      {account.display_name ?? account.handle} · {account.platform}{' '}
                      · {entityLabelOrFirm(account.entity_id)}
                    </option>
                  ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="camp_external">External campaign id</Label>
                <Input id="camp_external" name="external_campaign_id" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="camp_revenue">Attributed revenue ($k)</Label>
                <Input
                  id="camp_revenue"
                  name="attributed_revenue_k"
                  type="number"
                  min={0}
                  step="0.1"
                />
              </div>
            </div>
            <Button type="submit" size="sm" disabled={campPending}>
              Create campaign
            </Button>
            <Msg state={campState} />
          </form>

          <form action={contentAction} className="space-y-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">New content</h2>
            <div className="space-y-1">
              <Label htmlFor="ct_title">Title</Label>
              <Input id="ct_title" name="title" required />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="ct_kind">Kind</Label>
                <select id="ct_kind" name="kind" className={field} defaultValue="social">
                  <option value="blog">Blog</option>
                  <option value="social">Social</option>
                  <option value="email">Email</option>
                  <option value="landing">Landing</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ct_plat">Platform</Label>
                <select id="ct_plat" name="platform" className={field} defaultValue="linkedin">
                  <option value="linkedin">LinkedIn</option>
                  <option value="x">X</option>
                  <option value="instagram">Instagram</option>
                  <option value="facebook">Facebook</option>
                  <option value="youtube">YouTube</option>
                  <option value="tiktok">TikTok</option>
                  <option value="web">Web</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ct_body">Body</Label>
              <textarea
                id="ct_body"
                name="body"
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ct_camp">Campaign id (optional)</Label>
              <Input id="ct_camp" name="campaign_id" placeholder="CMP-…" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ct_media">Video URL (TikTok optional)</Label>
              <Input
                id="ct_media"
                name="media_url"
                type="url"
                placeholder="https://cdn.example.com/video.mp4"
              />
            </div>
            <Button type="submit" size="sm" disabled={contentPending}>
              Create content
            </Button>
            <Msg state={contentState} />
          </form>

          <form action={acctAction} className="space-y-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">Register social account</h2>
            <p className="text-xs text-muted-foreground">
              Prefer the Publish desk above. Advanced: register here, then
              Connect via OAuth (or stub) for LinkedIn, X, Meta, YouTube,
              TikTok, or Blog.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="ac_plat">Platform</Label>
                <select id="ac_plat" name="platform" className={field} defaultValue="linkedin">
                  <option value="linkedin">LinkedIn</option>
                  <option value="x">X</option>
                  <option value="instagram">Instagram</option>
                  <option value="facebook">Facebook</option>
                  <option value="youtube">YouTube</option>
                  <option value="tiktok">TikTok</option>
                  <option value="web">Blog / CMS</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ac_handle">Handle</Label>
                <Input id="ac_handle" name="handle" required placeholder="tagevc" />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ac_type">Connection type</Label>
              <select
                id="ac_type"
                name="account_type"
                className={field}
                defaultValue="publisher"
              >
                <option value="publisher">Publisher</option>
                <option value="paid_ads">Paid advertising</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ac_entity">Company (optional)</Label>
              <CompanySelect
                id="ac_entity"
                name="entity_id"
                allowAll
                allLabel="Firm-wide"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ac_external">
                Provider account ID (optional; discovery follows OAuth)
              </Label>
              <Input
                id="ac_external"
                name="external_account_id"
                placeholder="act_123… or LinkedIn ad account URN"
              />
            </div>
            <Button type="submit" size="sm" disabled={acctPending}>
              Register
            </Button>
            <Msg state={acctState} />
          </form>

          <form action={genAction} className="space-y-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">AI draft</h2>
            <div className="space-y-1">
              <Label htmlFor="gen_prompt">Prompt</Label>
              <textarea
                id="gen_prompt"
                name="prompt"
                required
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Announce our new fund thesis…"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gen_kind">Kind</Label>
              <select id="gen_kind" name="kind" className={field} defaultValue="social">
                <option value="social">Social</option>
                <option value="blog">Blog</option>
                <option value="both">Both</option>
              </select>
            </div>
            <Button type="submit" size="sm" disabled={genPending}>
              {genPending ? 'Generating…' : 'Generate draft'}
            </Button>
            <Msg state={genState} />
          </form>

          <form action={voiceAction} className="space-y-3 rounded-lg border p-4 lg:col-span-2">
            <h2 className="text-sm font-semibold">Brand voice</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="bv_name">Name</Label>
                <Input id="bv_name" name="name" required placeholder="Tage VC default" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="bv_entity">Company (blank = firm)</Label>
                <CompanySelect
                  id="bv_entity"
                  name="entity_id"
                  allowAll
                  allLabel="Firm-wide"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="bv_tone">Tone guidelines</Label>
              <textarea
                id="bv_tone"
                name="tone_guidelines"
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Confident, concise, no hype…"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bv_aud">Audience</Label>
              <Input id="bv_aud" name="audience" placeholder="Founders, LPs" />
            </div>
            <Button type="submit" size="sm" disabled={voicePending}>
              {voicePending ? 'Saving…' : 'Save brand voice'}
            </Button>
            <Msg state={voiceState} />
          </form>
        </div>
      )}

      {canWrite && (
        <form
          onSubmit={uploadTikTokVideo}
          className="space-y-3 rounded-lg border p-4"
        >
          <h2 className="text-sm font-semibold">Resumable TikTok upload</h2>
          <p className="text-xs text-muted-foreground">
            Immediate approved-content upload. Each chunk is acknowledged before
            publish-status polling begins.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <select name="content_id" className={field} required defaultValue="">
              <option value="">Approved TikTok content</option>
              {content
                .filter(
                  (item) =>
                    item.platform === 'tiktok' && item.status === 'approved',
                )
                .map((item) => (
                  <option value={item.content_id} key={item.content_id}>
                    {item.title} · {entityLabelOrFirm(item.entity_id)}
                  </option>
                ))}
            </select>
            <select name="account_id" className={field} required defaultValue="">
              <option value="">Connected TikTok publisher</option>
              {accounts
                .filter(
                  (account) =>
                    account.platform === 'tiktok' &&
                    account.account_type === 'publisher' &&
                    account.status === 'connected',
                )
                .map((account) => (
                  <option value={account.account_id} key={account.account_id}>
                    @{account.handle} · {entityLabelOrFirm(account.entity_id)}
                  </option>
                ))}
            </select>
          </div>
          <Input
            type="file"
            name="video_file"
            accept="video/mp4,video/quicktime,video/webm"
            required
          />
          <select name="privacy_level" className={field} required defaultValue="">
            <option value="" disabled>
              Choose privacy (no default)
            </option>
            <option value="SELF_ONLY">Only me</option>
            <option value="MUTUAL_FOLLOW_FRIENDS">Friends</option>
            <option value="FOLLOWER_OF_CREATOR">Followers</option>
            <option value="PUBLIC_TO_EVERYONE">Public</option>
          </select>
          <div className="flex flex-wrap gap-3 text-xs">
            {[
              ['disable_comment', 'Disable comments'],
              ['disable_duet', 'Disable duet'],
              ['disable_stitch', 'Disable stitch'],
            ].map(([name, label]) => (
              <label key={name} className="flex items-center gap-1">
                <input type="checkbox" name={name} /> {label}
              </label>
            ))}
          </div>
          <Button type="submit" size="sm" disabled={tiktokUpload.busy}>
            {tiktokUpload.busy
              ? `Uploading ${tiktokUpload.progress}%`
              : 'Upload to TikTok'}
          </Button>
          {tiktokUpload.message ? (
            <p className="text-xs text-muted-foreground">
              {tiktokUpload.message}
            </p>
          ) : null}
        </form>
      )}

      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setFlash(null);
              setErr(null);
              startTransition(async () => {
                const res = await runScheduleWorkerAction();
                if (res.ok) setFlash(res.message ?? 'Done');
                else setErr(res.error);
              });
            }}
          >
            {pending ? 'Running…' : 'Run schedule worker now'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => refreshTokensAction())}
          >
            Refresh OAuth tokens
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => pullEngagementAction())}
          >
            Pull live engagement
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => runApprovalSlaDigestAction())}
          >
            Run SLA digest
          </Button>
        </div>
      )}

      <section id="mkt-brand" className="scroll-mt-20 space-y-2">
        <h2 className="text-base font-semibold">Brand voices</h2>
        {brandVoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet — firm default uses generic tone.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {brandVoices.map((v) => (
              <li key={v.voice_id} className="border-b border-border/40 py-1.5">
                <span className="font-medium">{v.name}</span>
                {v.entity_id
                  ? ` · ${entityLabelOrFirm(v.entity_id)}`
                  : ' · firm-wide'}
                {v.tone_guidelines ? (
                  <span className="block text-xs text-muted-foreground">
                    {v.tone_guidelines.slice(0, 120)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="mkt-campaigns" className="scroll-mt-20 space-y-3">
        <h2 className="text-base font-semibold">Campaigns</h2>
        {campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No campaigns yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {campaigns.map((c) => (
              <li key={c.campaign_id} className="border-b border-border/40 py-2">
                <span className="font-mono text-xs">{c.campaign_id}</span>
                {' · '}
                <span className="font-medium">{c.name}</span>
                {' · '}
                {c.status}
                {c.channel === 'paid' ? ' · paid' : ''}
                {c.budget_k != null ? ` · $${c.budget_k}k` : ''}
                {c.ad_platform ? ` · ${c.ad_platform}` : ''}
                {c.ad_account_id ? ` · account ${c.ad_account_id}` : ''}
                {c.entity_id
                  ? ` · ${entityLabelOrFirm(c.entity_id)}`
                  : ' · firm-wide'}
                {analytics.by_campaign[c.campaign_id] != null ? (
                  <span className="text-xs text-muted-foreground">
                    {' '}
                    · {analytics.by_campaign[c.campaign_id]} events
                  </span>
                ) : null}
                {canWrite && c.channel === 'paid' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="ml-2"
                    disabled={pending}
                    onClick={() =>
                      run(() => syncPaidCampaignAction(c.campaign_id))
                    }
                  >
                    Sync paid
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Content</h2>
        {content.length === 0 ? (
          <p className="text-sm text-muted-foreground">No content yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-2">Id</th>
                  <th className="py-2 pr-2">Title</th>
                  <th className="py-2 pr-2">Kind</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {content.map((c) => (
                  <tr key={c.content_id} className="border-b border-border/40">
                    <td className="py-2 pr-2 font-mono text-xs">{c.content_id}</td>
                    <td className="py-2 pr-2">
                      {c.title}
                      {c.ai_generated ? (
                        <span className="ml-1 text-xs text-sky-700">AI</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2">
                      {c.kind}
                      {c.platform ? `/${c.platform}` : ''}
                    </td>
                    <td className="py-2 pr-2">
                      {c.status}
                      {c.status === 'review' && c.approval_due_at ? (
                        <span
                          className={`ml-1 text-xs ${
                            Date.parse(c.approval_due_at) < Date.now()
                              ? 'text-amber-700'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {Date.parse(c.approval_due_at) < Date.now()
                            ? 'overdue'
                            : `due ${c.approval_due_at.slice(0, 10)}`}
                        </span>
                      ) : null}
                      {c.approval_ticket_id ? (
                        <span className="block text-xs text-muted-foreground">
                          {c.approval_ticket_id}
                          {c.approval_assignee
                            ? ` → ${c.approval_assignee}`
                            : ''}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2">
                      {canWrite && (
                        <div className="flex flex-wrap gap-1">
                          {c.status === 'draft' && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() =>
                                run(() => submitForReviewAction(c.content_id))
                              }
                            >
                              Submit review
                            </Button>
                          )}
                          {(c.status === 'draft' || c.status === 'review') && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() =>
                                run(() => approveContentAction(c.content_id))
                              }
                            >
                              Approve
                            </Button>
                          )}
                          {c.status !== 'published' && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() => {
                                setFlash(null);
                                setErr(null);
                                const when = window.prompt(
                                  'Schedule for (ISO datetime):',
                                  new Date(Date.now() + 60_000).toISOString(),
                                );
                                if (!when) return;
                                const matchingAccounts = accounts.filter(
                                  (account) =>
                                    account.status === 'connected' &&
                                    account.platform === c.platform &&
                                    account.entity_id === c.entity_id,
                                );
                                const suggested =
                                  matchingAccounts[0]?.account_id ?? '';
                                const accountId = window.prompt(
                                  matchingAccounts.length > 0
                                    ? `Account ID (${matchingAccounts
                                        .map(
                                          (account) =>
                                            `${account.account_id}:${account.handle}`,
                                        )
                                        .join(', ')}):`
                                    : 'Account ID (blank uses stub/fallback):',
                                  suggested,
                                );
                                if (accountId == null) return;
                                startTransition(async () => {
                                  const res = await scheduleContentAction(
                                    c.content_id,
                                    when,
                                    accountId.trim() || undefined,
                                  );
                                  if (res.ok) setFlash(res.message ?? 'Queued');
                                  else setErr(res.error);
                                });
                              }}
                            >
                              Schedule
                            </Button>
                          )}
                          {(c.status === 'published' ||
                            c.status === 'scheduled') && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() => {
                                const impressions = Number(
                                  window.prompt('Impressions', '100') ?? '',
                                );
                                const clicks = Number(
                                  window.prompt('Clicks', '5') ?? '',
                                );
                                const likes = Number(
                                  window.prompt('Likes', '10') ?? '',
                                );
                                if (
                                  Number.isNaN(impressions) ||
                                  Number.isNaN(clicks) ||
                                  Number.isNaN(likes)
                                ) {
                                  return;
                                }
                                run(() =>
                                  recordEngagementAction(
                                    c.content_id,
                                    impressions,
                                    clicks,
                                    likes,
                                  ),
                                );
                              }}
                            >
                              Eng.
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Social accounts</h2>
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accounts registered.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {accounts.map((a) => (
              <li key={a.account_id} className="border-b border-border/40 py-2">
                <span className="font-medium">{a.platform}</span> @{a.handle}
                {' · '}
                {a.status}
                {` · ${a.account_type}`}
                {a.entity_id
                  ? ` · ${entityLabelOrFirm(a.entity_id)}`
                  : ' · firm'}
                {a.external_account_id ? ` · ${a.external_account_id}` : ''}
                {a.currency ? ` · ${a.currency}` : ''}
                {a.account_type === 'paid_ads'
                  ? ` · scopes ${a.scope_status}`
                  : ''}
                {a.account_type === 'paid_ads'
                  ? ` · metrics ${a.paid_metrics_status}${
                      a.paid_metrics_data_through
                        ? ` through ${a.paid_metrics_data_through}`
                        : ''
                    }`
                  : ''}
                {canWrite &&
                  a.status !== 'connected' &&
                  OAUTH_SET.has(a.platform) && (
                    <a
                      href={`/api/marketing/oauth/${a.platform}?account_id=${encodeURIComponent(a.account_id)}`}
                      className="ml-2 text-xs font-medium underline-offset-4 hover:underline"
                    >
                      Connect
                    </a>
                  )}
                {canWrite && a.account_type === 'paid_ads' && (
                  <button
                    type="button"
                    className="ml-2 text-xs font-medium underline-offset-4 hover:underline"
                    disabled={pending}
                    onClick={() => discoverAdAccount(a.account_id)}
                  >
                    Discover / select
                  </button>
                )}
                {canWrite &&
                  a.account_type === 'paid_ads' &&
                  a.status === 'connected' && (
                    <button
                      type="button"
                      className="ml-2 text-xs font-medium underline-offset-4 hover:underline"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          queuePaidMetricsBackfillAction(a.account_id),
                        )
                      }
                    >
                      Queue 90d / refresh
                    </button>
                  )}
                {canWrite &&
                  a.account_type === 'publisher' &&
                  a.platform === 'web' &&
                  a.status !== 'connected' && (
                  <button
                    type="button"
                    className="ml-2 text-xs font-medium underline-offset-4 hover:underline"
                    disabled={pending}
                    onClick={() =>
                      run(() => connectBlogAccountAction(a.account_id))
                    }
                  >
                    Mark blog ready
                  </button>
                )}
                {canWrite &&
                  a.account_type === 'publisher' &&
                  a.platform !== 'web' &&
                  a.status !== 'connected' && (
                  <button
                    type="button"
                    className="ml-2 text-xs font-medium underline-offset-4 hover:underline"
                    disabled={pending}
                    onClick={() =>
                      run(() => stubConnectAccountAction(a.account_id))
                    }
                  >
                    Stub connect
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Schedule queue</h2>
          {scheduleJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Empty.</p>
          ) : (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {scheduleJobs.map((j) => (
                <li key={j.job_id}>
                  <span
                    className={
                      j.status === 'pending'
                        ? 'text-amber-700'
                        : j.status === 'failed'
                          ? 'text-destructive'
                          : j.status === 'succeeded'
                            ? 'text-emerald-700'
                            : undefined
                    }
                  >
                    {j.status}
                  </span>
                  {' · '}
                  {j.scheduled_for.slice(0, 16).replace('T', ' ')} · {j.content_id}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Generation jobs</h2>
          {generationJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Empty.</p>
          ) : (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {generationJobs.map((j) => (
                <li key={j.job_id}>
                  {j.job_id} · {j.status} · {j.kind}
                  {j.result_content_ids.length
                    ? ` → ${j.result_content_ids.join(', ')}`
                    : ''}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

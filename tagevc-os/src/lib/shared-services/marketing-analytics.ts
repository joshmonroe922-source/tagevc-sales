/**
 * Marketing analytics — post results, engagement, trends (Phases 24–25).
 */

import { randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';

export type MarketingAnalyticsEvent = {
  event_id: string;
  campaign_id: string | null;
  content_id: string | null;
  job_id: string | null;
  account_id: string | null;
  entity_id: string | null;
  platform: string | null;
  kind: string;
  metrics: Record<string, unknown>;
  occurred_at: string;
};

export type MarketingAnalyticsSummary = {
  posts_succeeded: number;
  posts_failed: number;
  posts_stub: number;
  by_platform: Record<string, number>;
  by_campaign: Record<string, number>;
  engagement_by_platform: Record<
    string,
    {
      impressions: number;
      clicks: number;
      likes: number;
      comments: number;
      shares: number;
      posts: number;
      /** (likes+comments+shares+clicks) / impressions when impressions > 0 */
      engagement_rate: number | null;
    }
  >;
  recent: MarketingAnalyticsEvent[];
  engagement_impressions: number;
  engagement_clicks: number;
  engagement_likes: number;
  engagement_comments: number;
  engagement_shares: number;
  /** Overall engagement rate across all platforms */
  engagement_rate: number | null;
  engagement_api: number;
  engagement_manual: number;
  /** Last 7 calendar days: YYYY-MM-DD → post + engagement counts */
  trend_7d: Array<{
    day: string;
    posts: number;
    engagement_events: number;
    impressions: number;
  }>;
  /** Platforms ranked by impressions (Phase 26 comparison) */
  platform_rank: Array<{
    platform: string;
    impressions: number;
    engagement_rate: number | null;
  }>;
  paid_spend_k: number;
  paid_revenue_k: number;
  paid_roi: number | null;
  paid_roas: number | null;
  paid_ctr: number | null;
  paid_currencies: string[];
  paid_currency_mixed: boolean;
  paid_reporting_days: 7 | 30 | 90;
  paid_data_through: string | null;
  paid_typed: boolean;
  paid_daily_trend: Array<{
    day: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
  }>;
  paid_campaigns: Array<{
    campaign_id: string;
    campaign_name: string | null;
    entity_id: string | null;
    platform: string;
    currency: string;
    impressions: number;
    clicks: number;
    conversions: number;
    spend_k: number;
    revenue_k: number;
    roi: number | null;
    roas: number | null;
    cpc: number | null;
    cpm: number | null;
    cpa: number | null;
    budget_utilization: number | null;
    reporting_start: string | null;
    reporting_end: string | null;
  }>;
};

function mapEvent(row: Record<string, unknown>): MarketingAnalyticsEvent {
  return {
    event_id: String(row.event_id),
    campaign_id: (row.campaign_id as string) ?? null,
    content_id: (row.content_id as string) ?? null,
    job_id: (row.job_id as string) ?? null,
    account_id: (row.account_id as string) ?? null,
    entity_id: (row.entity_id as string) ?? null,
    platform: (row.platform as string) ?? null,
    kind: String(row.kind),
    metrics: (row.metrics as Record<string, unknown>) ?? {},
    occurred_at: String(row.occurred_at),
  };
}

function emptyTrend7d(): MarketingAnalyticsSummary['trend_7d'] {
  const out: MarketingAnalyticsSummary['trend_7d'] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    out.push({
      day: d.toISOString().slice(0, 10),
      posts: 0,
      engagement_events: 0,
      impressions: 0,
    });
  }
  return out;
}

export async function recordMarketingAnalyticsEvent(input: {
  event_id?: string;
  kind: string;
  campaign_id?: string | null;
  content_id?: string | null;
  job_id?: string | null;
  account_id?: string | null;
  entity_id?: string | null;
  platform?: string | null;
  metrics?: Record<string, unknown>;
  occurred_at?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const row = {
      event_id: input.event_id ?? `MAE-${randomUUID().slice(0, 8)}`,
      kind: input.kind,
      campaign_id: input.campaign_id ?? null,
      content_id: input.content_id ?? null,
      job_id: input.job_id ?? null,
      account_id: input.account_id ?? null,
      entity_id: input.entity_id ?? null,
      platform: input.platform ?? null,
      metrics: input.metrics ?? {},
      occurred_at: input.occurred_at ?? new Date().toISOString(),
    };
    const { error } = input.event_id
      ? await sb
          .from('os_marketing_analytics_events')
          .upsert(row, { onConflict: 'event_id' })
      : await sb.from('os_marketing_analytics_events').insert(row);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'analytics insert failed',
    };
  }
}

/** Record manual/stub engagement for a published content item. */
export async function recordEngagement(input: {
  content_id: string;
  campaign_id?: string | null;
  entity_id?: string | null;
  platform?: string | null;
  impressions?: number;
  clicks?: number;
  likes?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return recordMarketingAnalyticsEvent({
    kind: 'engagement',
    content_id: input.content_id,
    campaign_id: input.campaign_id,
    entity_id: input.entity_id,
    platform: input.platform,
    metrics: {
      source: 'manual',
      impressions: input.impressions ?? 0,
      clicks: input.clicks ?? 0,
      likes: input.likes ?? 0,
    },
  });
}

export async function getMarketingAnalyticsSummary(opts?: {
  limit?: number;
  paidDays?: 7 | 30 | 90;
  entityId?: string | null;
}): Promise<{ summary: MarketingAnalyticsSummary; error?: string }> {
  const empty: MarketingAnalyticsSummary = {
    posts_succeeded: 0,
    posts_failed: 0,
    posts_stub: 0,
    by_platform: {},
    by_campaign: {},
    engagement_by_platform: {},
    recent: [],
    engagement_impressions: 0,
    engagement_clicks: 0,
    engagement_likes: 0,
    engagement_comments: 0,
    engagement_shares: 0,
    engagement_rate: null,
    engagement_api: 0,
    engagement_manual: 0,
    trend_7d: emptyTrend7d(),
    platform_rank: [],
    paid_spend_k: 0,
    paid_revenue_k: 0,
    paid_roi: null,
    paid_roas: null,
    paid_ctr: null,
    paid_currencies: [],
    paid_currency_mixed: false,
    paid_reporting_days: opts?.paidDays ?? 30,
    paid_data_through: null,
    paid_typed: false,
    paid_daily_trend: [],
    paid_campaigns: [],
  };

  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_marketing_analytics_events')
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(opts?.limit ?? 300);

    if (error) return { summary: empty, error: error.message };

    const events = (data ?? []).map((r) =>
      mapEvent(r as Record<string, unknown>),
    );
    const summary: MarketingAnalyticsSummary = {
      ...empty,
      recent: events.slice(0, 25),
      trend_7d: emptyTrend7d(),
    };
    const dayIndex = new Map(
      summary.trend_7d.map((t, i) => [t.day, i] as const),
    );
    const postsByPlatform: Record<string, number> = {};
    const seenPaidSnapshots = new Set<string>();
    let paidImpressions = 0;
    let paidClicks = 0;
    const paidCurrencies = new Set<string>();

    for (const e of events) {
      const day = e.occurred_at.slice(0, 10);
      const ti = dayIndex.get(day);

      if (e.kind === 'post_succeeded') {
        summary.posts_succeeded += 1;
        if (e.metrics.stub) summary.posts_stub += 1;
        if (ti != null) summary.trend_7d[ti].posts += 1;
        if (e.platform) {
          postsByPlatform[e.platform] = (postsByPlatform[e.platform] ?? 0) + 1;
        }
      } else if (e.kind === 'post_failed') {
        summary.posts_failed += 1;
      } else if (e.kind === 'engagement') {
        const paid = e.metrics.source === 'paid_api';
        const paidKey = `${e.campaign_id ?? '-'}:${e.platform ?? '-'}`;
        if (paid && seenPaidSnapshots.has(paidKey)) continue;
        if (paid) seenPaidSnapshots.add(paidKey);
        const impressions = Number(e.metrics.impressions ?? 0);
        const clicks = Number(e.metrics.clicks ?? 0);
        const likes = Number(e.metrics.likes ?? 0);
        const comments = Number(e.metrics.comments ?? 0);
        const shares = Number(e.metrics.shares ?? 0);
        if (paid && e.campaign_id) {
          const spendK = Number(e.metrics.spend ?? 0) / 1000;
          const revenueK = Number(e.metrics.revenue_k ?? 0);
          const conversions = Number(e.metrics.conversions ?? 0);
          const currency = String(e.metrics.currency ?? 'USD');
          paidCurrencies.add(currency);
          summary.paid_spend_k += spendK;
          summary.paid_revenue_k += revenueK;
          paidImpressions += impressions;
          paidClicks += clicks;
          summary.paid_campaigns.push({
            campaign_id: e.campaign_id,
            campaign_name: null,
            entity_id: e.entity_id,
            platform: e.platform ?? 'paid',
            currency,
            impressions,
            clicks,
            conversions,
            spend_k: spendK,
            revenue_k: revenueK,
            roi: spendK > 0 ? (revenueK - spendK) / spendK : null,
            roas: spendK > 0 ? revenueK / spendK : null,
            cpc:
              e.metrics.cpc == null ? null : Number(e.metrics.cpc),
            cpm:
              e.metrics.cpm == null ? null : Number(e.metrics.cpm),
            cpa:
              e.metrics.cpa == null ? null : Number(e.metrics.cpa),
            budget_utilization:
              e.metrics.budget_utilization == null
                ? null
                : Number(e.metrics.budget_utilization),
            reporting_start:
              typeof e.metrics.reporting_start === 'string'
                ? e.metrics.reporting_start
                : null,
            reporting_end:
              typeof e.metrics.reporting_end === 'string'
                ? e.metrics.reporting_end
                : null,
          });
        }
        if (paid) continue;
        summary.engagement_impressions += impressions;
        summary.engagement_clicks += clicks;
        summary.engagement_likes += likes;
        summary.engagement_comments += comments;
        summary.engagement_shares += shares;
        if (e.metrics.source === 'api') summary.engagement_api += 1;
        else summary.engagement_manual += 1;
        if (ti != null) {
          summary.trend_7d[ti].engagement_events += 1;
          summary.trend_7d[ti].impressions += impressions;
        }
        if (e.platform) {
          const bucket = summary.engagement_by_platform[e.platform] ?? {
            impressions: 0,
            clicks: 0,
            likes: 0,
            comments: 0,
            shares: 0,
            posts: 0,
            engagement_rate: null,
          };
          bucket.impressions += impressions;
          bucket.clicks += clicks;
          bucket.likes += likes;
          bucket.comments += comments;
          bucket.shares += shares;
          summary.engagement_by_platform[e.platform] = bucket;
        }
      }
      if (e.platform) {
        summary.by_platform[e.platform] =
          (summary.by_platform[e.platform] ?? 0) + 1;
      }
      if (e.campaign_id) {
        summary.by_campaign[e.campaign_id] =
          (summary.by_campaign[e.campaign_id] ?? 0) + 1;
      }
    }

    const engTotal =
      summary.engagement_likes +
      summary.engagement_comments +
      summary.engagement_shares +
      summary.engagement_clicks;
    summary.engagement_rate =
      summary.engagement_impressions > 0
        ? engTotal / summary.engagement_impressions
        : null;
    summary.paid_roi =
      summary.paid_spend_k > 0
        ? (summary.paid_revenue_k - summary.paid_spend_k) /
          summary.paid_spend_k
        : null;
    summary.paid_roas =
      summary.paid_spend_k > 0
        ? summary.paid_revenue_k / summary.paid_spend_k
        : null;
    summary.paid_ctr =
      paidImpressions > 0 ? paidClicks / paidImpressions : null;
    summary.paid_currencies = [...paidCurrencies].sort();
    summary.paid_currency_mixed = paidCurrencies.size > 1;
    if (summary.paid_currency_mixed) {
      summary.paid_roi = null;
      summary.paid_roas = null;
    }

    const paidDays = opts?.paidDays ?? 30;
    const paidStart = new Date();
    paidStart.setUTCDate(paidStart.getUTCDate() - paidDays);
    let paidQuery = sb
      .from('os_marketing_paid_metrics_daily')
      .select(
        'campaign_id, entity_id, provider, currency, metric_date, impressions, clicks, spend, conversions',
      )
      .gte('metric_date', paidStart.toISOString().slice(0, 10))
      .order('metric_date', { ascending: true });
    if (opts?.entityId) paidQuery = paidQuery.eq('entity_id', opts.entityId);
    const { data: typedPaidRows } = await paidQuery;
    if (typedPaidRows && typedPaidRows.length > 0) {
      summary.paid_typed = true;
      summary.paid_reporting_days = paidDays;
      summary.paid_campaigns = [];
      summary.paid_spend_k = 0;
      summary.paid_revenue_k = 0;
      summary.paid_roi = null;
      summary.paid_roas = null;
      const currencies = new Set<string>();
      const campaignBuckets = new Map<
        string,
        {
          campaign_id: string;
          campaign_name: string | null;
          entity_id: string | null;
          platform: string;
          currency: string;
          impressions: number;
          clicks: number;
          conversions: number;
          spend_k: number;
          revenue_k: number;
          roi: null;
          roas: null;
          cpc: number | null;
          cpm: number | null;
          cpa: number | null;
          budget_utilization: null;
          reporting_start: string | null;
          reporting_end: string | null;
        }
      >();
      const trend = new Map<
        string,
        {
          day: string;
          spend: number;
          impressions: number;
          clicks: number;
          conversions: number;
        }
      >();
      for (const row of typedPaidRows) {
        const day = String(row.metric_date);
        const spend = Number(row.spend ?? 0);
        const impressions = Number(row.impressions ?? 0);
        const clicks = Number(row.clicks ?? 0);
        const conversions = Number(row.conversions ?? 0);
        const currency = String(row.currency ?? 'USD');
        const campaignId = String(row.campaign_id);
        currencies.add(currency);
        summary.paid_spend_k += spend / 1000;
        summary.paid_data_through =
          !summary.paid_data_through || day > summary.paid_data_through
            ? day
            : summary.paid_data_through;
        const daily = trend.get(day) ?? {
          day,
          spend: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
        };
        daily.spend += spend;
        daily.impressions += impressions;
        daily.clicks += clicks;
        daily.conversions += conversions;
        trend.set(day, daily);
        const bucket = campaignBuckets.get(campaignId) ?? {
          campaign_id: campaignId,
          campaign_name: null,
          entity_id: (row.entity_id as string) ?? null,
          platform: String(row.provider),
          currency,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          spend_k: 0,
          revenue_k: 0,
          roi: null,
          roas: null,
          cpc: null,
          cpm: null,
          cpa: null,
          budget_utilization: null,
          reporting_start: day,
          reporting_end: day,
        };
        bucket.impressions += impressions;
        bucket.clicks += clicks;
        bucket.conversions += conversions;
        bucket.spend_k += spend / 1000;
        bucket.reporting_start =
          !bucket.reporting_start || day < bucket.reporting_start
            ? day
            : bucket.reporting_start;
        bucket.reporting_end =
          !bucket.reporting_end || day > bucket.reporting_end
            ? day
            : bucket.reporting_end;
        campaignBuckets.set(campaignId, bucket);
      }
      summary.paid_daily_trend = [...trend.values()];
      summary.paid_campaigns = [...campaignBuckets.values()].map((bucket) => ({
        ...bucket,
        cpc:
          bucket.clicks > 0 ? (bucket.spend_k * 1000) / bucket.clicks : null,
        cpm:
          bucket.impressions > 0
            ? ((bucket.spend_k * 1000) / bucket.impressions) * 1000
            : null,
        cpa:
          bucket.conversions > 0
            ? (bucket.spend_k * 1000) / bucket.conversions
            : null,
      }));
      summary.paid_currencies = [...currencies].sort();
      summary.paid_currency_mixed = currencies.size > 1;
      const typedImpressions = summary.paid_campaigns.reduce(
        (total, campaign) => total + campaign.impressions,
        0,
      );
      const typedClicks = summary.paid_campaigns.reduce(
        (total, campaign) => total + campaign.clicks,
        0,
      );
      summary.paid_ctr =
        typedImpressions > 0 ? typedClicks / typedImpressions : null;
    }

    if (summary.paid_campaigns.length > 0) {
      const campaignIds = summary.paid_campaigns.map((p) => p.campaign_id);
      const { data: paidCampaignRows } = await sb
        .from('os_marketing_campaigns')
        .select('campaign_id, name, entity_id')
        .in('campaign_id', campaignIds);
      const campaignMeta = new Map(
        (paidCampaignRows ?? []).map((row) => [
          String(row.campaign_id),
          {
            name: String(row.name),
            entity_id: (row.entity_id as string) ?? null,
          },
        ]),
      );
      for (const paidCampaign of summary.paid_campaigns) {
        const meta = campaignMeta.get(paidCampaign.campaign_id);
        if (meta) {
          paidCampaign.campaign_name = meta.name;
          paidCampaign.entity_id = meta.entity_id;
        }
      }
    }

    for (const [plat, bucket] of Object.entries(summary.engagement_by_platform)) {
      bucket.posts = postsByPlatform[plat] ?? 0;
      const t =
        bucket.likes + bucket.comments + bucket.shares + bucket.clicks;
      bucket.engagement_rate =
        bucket.impressions > 0 ? t / bucket.impressions : null;
    }

    summary.platform_rank = Object.entries(summary.engagement_by_platform)
      .map(([platform, m]) => ({
        platform,
        impressions: m.impressions,
        engagement_rate: m.engagement_rate,
      }))
      .sort((a, b) => b.impressions - a.impressions);

    if (summary.posts_succeeded + summary.posts_failed === 0) {
      const { data: jobs } = await sb
        .from('os_marketing_schedule_jobs')
        .select('status, publisher, result')
        .in('status', ['succeeded', 'failed'])
        .limit(100);
      for (const j of jobs ?? []) {
        const row = j as {
          status: string;
          publisher?: string;
          result?: { stub?: boolean };
        };
        if (row.status === 'succeeded') {
          summary.posts_succeeded += 1;
          if (row.result?.stub || row.publisher === 'stub') {
            summary.posts_stub += 1;
          }
        } else {
          summary.posts_failed += 1;
        }
      }
    }

    return { summary };
  } catch (e) {
    return {
      summary: empty,
      error: e instanceof Error ? e.message : 'analytics failed',
    };
  }
}

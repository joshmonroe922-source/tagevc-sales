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
    const { error } = await sb.from('os_marketing_analytics_events').insert({
      event_id: `MAE-${randomUUID().slice(0, 8)}`,
      kind: input.kind,
      campaign_id: input.campaign_id ?? null,
      content_id: input.content_id ?? null,
      job_id: input.job_id ?? null,
      account_id: input.account_id ?? null,
      entity_id: input.entity_id ?? null,
      platform: input.platform ?? null,
      metrics: input.metrics ?? {},
      occurred_at: input.occurred_at ?? new Date().toISOString(),
    });
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
        const impressions = Number(e.metrics.impressions ?? 0);
        const clicks = Number(e.metrics.clicks ?? 0);
        const likes = Number(e.metrics.likes ?? 0);
        const comments = Number(e.metrics.comments ?? 0);
        const shares = Number(e.metrics.shares ?? 0);
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

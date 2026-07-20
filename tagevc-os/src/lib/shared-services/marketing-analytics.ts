/**
 * Marketing analytics — post results + engagement snapshots (Phase 24).
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
  recent: MarketingAnalyticsEvent[];
  engagement_impressions: number;
  engagement_clicks: number;
  engagement_likes: number;
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
    recent: [],
    engagement_impressions: 0,
    engagement_clicks: 0,
    engagement_likes: 0,
  };

  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_marketing_analytics_events')
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(opts?.limit ?? 200);

    if (error) return { summary: empty, error: error.message };

    const events = (data ?? []).map((r) =>
      mapEvent(r as Record<string, unknown>),
    );
    const summary: MarketingAnalyticsSummary = { ...empty, recent: events.slice(0, 25) };

    for (const e of events) {
      if (e.kind === 'post_succeeded') {
        summary.posts_succeeded += 1;
        if (e.metrics.stub) summary.posts_stub += 1;
      } else if (e.kind === 'post_failed') {
        summary.posts_failed += 1;
      } else if (e.kind === 'engagement') {
        summary.engagement_impressions += Number(e.metrics.impressions ?? 0);
        summary.engagement_clicks += Number(e.metrics.clicks ?? 0);
        summary.engagement_likes += Number(e.metrics.likes ?? 0);
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

    // Also fold in schedule job outcomes if analytics table empty of posts
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

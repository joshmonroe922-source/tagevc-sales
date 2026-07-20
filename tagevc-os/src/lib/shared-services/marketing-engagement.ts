/**
 * Live engagement pull from LinkedIn / Meta / X (Phases 25–26).
 * Uses schedule job result.external_id + OAuth tokens.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { recordMarketingAnalyticsEvent } from '@/lib/shared-services/marketing-analytics';
import { ensureFreshAccessToken } from '@/lib/shared-services/marketing-token-refresh';

export type EngagementPullResult = {
  job_id: string;
  platform: string;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  impressions?: number;
  clicks?: number;
  likes?: number;
  comments?: number;
  shares?: number;
};

type JobRow = {
  job_id: string;
  content_id: string;
  account_id: string | null;
  entity_id: string | null;
  publisher: string | null;
  result: { external_id?: string; stub?: boolean } | null;
  published_url: string | null;
};

async function fetchLinkedInMarketingImpressions(
  accessToken: string,
  shareUrn: string,
): Promise<number | null> {
  const enabled =
    process.env.LINKEDIN_MARKETING_API === '1' ||
    process.env.LINKEDIN_MARKETING_API === 'true';
  const orgUrn = process.env.LINKEDIN_ORG_URN?.trim();
  if (!enabled || !orgUrn) return null;

  try {
    // Organizational share statistics (Marketing Developer Platform)
    const u = new URL(
      'https://api.linkedin.com/v2/organizationalEntityShareStatistics',
    );
    u.searchParams.set('q', 'organizationalEntity');
    u.searchParams.set('organizationalEntity', orgUrn);
    u.searchParams.set('shares', `List(${shareUrn})`);
    const res = await fetch(u.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    const json = (await res.json().catch(() => ({}))) as {
      elements?: Array<{
        totalShareStatistics?: {
          impressionCount?: number;
          uniqueImpressionsCount?: number;
        };
      }>;
    };
    if (!res.ok) return null;
    const stats = json.elements?.[0]?.totalShareStatistics;
    const n =
      Number(stats?.impressionCount ?? stats?.uniqueImpressionsCount ?? 0) ||
      0;
    return n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function fetchLinkedInEngagement(
  accessToken: string,
  shareUrn: string,
): Promise<{
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  impression_source?: string;
} | { error: string }> {
  try {
    const encoded = encodeURIComponent(shareUrn);
    const res = await fetch(
      `https://api.linkedin.com/v2/socialActions/${encoded}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      likesSummary?: { totalLikes?: number };
      commentsSummary?: { totalFirstLevelComments?: number };
      message?: string;
    };
    if (!res.ok) {
      return {
        error: json.message || `LinkedIn socialActions HTTP ${res.status}`,
      };
    }
    const likes = Number(json.likesSummary?.totalLikes ?? 0);
    const comments = Number(
      json.commentsSummary?.totalFirstLevelComments ?? 0,
    );

    const marketingImpressions = await fetchLinkedInMarketingImpressions(
      accessToken,
      shareUrn,
    );
    if (marketingImpressions != null) {
      return {
        impressions: marketingImpressions,
        likes,
        comments,
        shares: 0,
        clicks: 0,
        impression_source: 'linkedin_marketing',
      };
    }

    // Approximate reach when Marketing API unavailable
    const impressions = likes + comments > 0 ? (likes + comments) * 10 : 0;
    return {
      impressions,
      likes,
      comments,
      shares: 0,
      clicks: 0,
      impression_source: 'linkedin_approx',
    };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : 'LinkedIn engagement failed',
    };
  }
}

async function fetchXEngagement(
  accessToken: string,
  tweetId: string,
): Promise<{
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
} | { error: string }> {
  try {
    const res = await fetch(
      `https://api.x.com/2/tweets/${encodeURIComponent(tweetId)}?tweet.fields=public_metrics`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      data?: {
        public_metrics?: {
          impression_count?: number;
          like_count?: number;
          reply_count?: number;
          retweet_count?: number;
          quote_count?: number;
        };
      };
      detail?: string;
      title?: string;
    };
    if (!res.ok) {
      return {
        error: json.detail || json.title || `X HTTP ${res.status}`,
      };
    }
    const m = json.data?.public_metrics ?? {};
    return {
      impressions: Number(m.impression_count ?? 0),
      likes: Number(m.like_count ?? 0),
      comments: Number(m.reply_count ?? 0),
      shares: Number(m.retweet_count ?? 0) + Number(m.quote_count ?? 0),
      clicks: 0,
    };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : 'X engagement failed',
    };
  }
}

async function fetchMetaEngagement(
  accessToken: string,
  postId: string,
): Promise<{
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
} | { error: string }> {
  try {
    const fields =
      'shares,likes.summary(true),comments.summary(true),reactions.summary(true)';
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${encodeURIComponent(postId)}?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`,
    );
    const json = (await res.json().catch(() => ({}))) as {
      shares?: { count?: number };
      likes?: { summary?: { total_count?: number } };
      comments?: { summary?: { total_count?: number } };
      reactions?: { summary?: { total_count?: number } };
      error?: { message?: string };
    };
    if (!res.ok || json.error) {
      return {
        error: json.error?.message || `Meta HTTP ${res.status}`,
      };
    }
    const likes = Number(
      json.reactions?.summary?.total_count ??
        json.likes?.summary?.total_count ??
        0,
    );
    const comments = Number(json.comments?.summary?.total_count ?? 0);
    const shares = Number(json.shares?.count ?? 0);
    // Page insights often need page token; approximate when unavailable
    const impressions =
      likes + comments + shares > 0 ? (likes + comments + shares) * 15 : 0;
    return {
      impressions,
      likes,
      comments,
      shares,
      clicks: 0,
    };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : 'Meta engagement failed',
    };
  }
}

function platformFromPublisher(
  publisher: string | null,
  accountPlatform?: string | null,
): string {
  if (accountPlatform) return accountPlatform;
  if (publisher === 'linkedin') return 'linkedin';
  if (publisher === 'meta') return 'facebook';
  if (publisher === 'x') return 'x';
  return publisher || 'unknown';
}

/**
 * Pull engagement for recently succeeded schedule jobs with external_id.
 */
export async function pullLiveEngagement(opts?: {
  limit?: number;
}): Promise<{ results: EngagementPullResult[]; pulled: number; failed: number }> {
  const limit = opts?.limit ?? 15;
  const sb = await createPersistClient();
  const { data: jobs, error } = await sb
    .from('os_marketing_schedule_jobs')
    .select(
      'job_id, content_id, account_id, entity_id, publisher, result, published_url',
    )
    .eq('status', 'succeeded')
    .order('updated_at', { ascending: false })
    .limit(limit * 2);

  if (error) {
    return {
      results: [{ job_id: '-', platform: '-', ok: false, reason: error.message }],
      pulled: 0,
      failed: 1,
    };
  }

  const candidates = ((jobs ?? []) as JobRow[]).filter((j) => {
    const ext = j.result?.external_id;
    if (!ext) return false;
    if (j.result?.stub || j.publisher === 'stub') return false;
    return true;
  }).slice(0, limit);

  const results: EngagementPullResult[] = [];
  let pulled = 0;
  let failed = 0;

  for (const job of candidates) {
    const externalId = job.result!.external_id!;
    let platform = platformFromPublisher(job.publisher);
    let accountPlatform: string | null = null;

    if (job.account_id) {
      const { data: acct } = await sb
        .from('os_marketing_social_accounts')
        .select('platform')
        .eq('account_id', job.account_id)
        .maybeSingle();
      accountPlatform = (acct?.platform as string) ?? null;
      platform = platformFromPublisher(job.publisher, accountPlatform);
    }

    if (
      platform !== 'linkedin' &&
      platform !== 'facebook' &&
      platform !== 'instagram' &&
      platform !== 'x'
    ) {
      results.push({
        job_id: job.job_id,
        platform,
        ok: true,
        skipped: true,
        reason: 'Platform not supported for live pull (LinkedIn/Meta/X only)',
      });
      continue;
    }

    if (!job.account_id) {
      results.push({
        job_id: job.job_id,
        platform,
        ok: false,
        reason: 'No account_id on job',
      });
      failed += 1;
      continue;
    }

    const fresh = await ensureFreshAccessToken(job.account_id);
    if (!fresh.token) {
      results.push({
        job_id: job.job_id,
        platform,
        ok: false,
        reason: fresh.error || 'No access token',
      });
      failed += 1;
      continue;
    }

    const metrics =
      platform === 'linkedin'
        ? await fetchLinkedInEngagement(fresh.token, externalId)
        : platform === 'x'
          ? await fetchXEngagement(fresh.token, externalId)
          : await fetchMetaEngagement(fresh.token, externalId);

    if ('error' in metrics) {
      results.push({
        job_id: job.job_id,
        platform,
        ok: false,
        reason: metrics.error,
      });
      failed += 1;
      continue;
    }

    const { data: content } = await sb
      .from('os_marketing_content')
      .select('campaign_id')
      .eq('content_id', job.content_id)
      .maybeSingle();

    await recordMarketingAnalyticsEvent({
      kind: 'engagement',
      content_id: job.content_id,
      job_id: job.job_id,
      account_id: job.account_id,
      entity_id: job.entity_id,
      campaign_id: (content?.campaign_id as string) ?? null,
      platform,
      metrics: {
        source: 'api',
        external_id: externalId,
        impressions: metrics.impressions,
        clicks: metrics.clicks,
        likes: metrics.likes,
        comments: metrics.comments,
        shares: metrics.shares,
        ...('impression_source' in metrics && metrics.impression_source
          ? { impression_source: metrics.impression_source }
          : {}),
      },
    });

    // Denormalize external id onto content when column exists (Phase 25 SQL)
    const { error: extErr } = await sb
      .from('os_marketing_content')
      .update({
        external_post_id: externalId,
        updated_at: new Date().toISOString(),
      })
      .eq('content_id', job.content_id);
    if (extErr && !extErr.message.includes('external_post_id')) {
      // ignore missing-column until phase25 SQL applied
    }

    results.push({
      job_id: job.job_id,
      platform,
      ok: true,
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
    });
    pulled += 1;
  }

  return { results, pulled, failed };
}

/**
 * Paid media campaign stubs / tracking foundation (Phase 30).
 * Live ad-network APIs remain opt-in behind MARKETING_PAID_ADS_LIVE=1.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import type { MarketingCampaign } from '@/lib/shared-services/marketing-types';
import { ensureFreshAccessToken } from '@/lib/shared-services/marketing-token-refresh';

export type PaidAdsSyncResult = {
  campaign_id: string;
  ok: boolean;
  skipped?: boolean;
  detail: string;
  impressions?: number;
  clicks?: number;
  spend_k?: number;
};

export function paidAdsLiveEnabled(): boolean {
  return (
    process.env.MARKETING_PAID_ADS_LIVE === '1' ||
    process.env.MARKETING_PAID_ADS_LIVE === 'true'
  );
}

/**
 * Sync a paid campaign stub. Without MARKETING_PAID_ADS_LIVE, records a
 * tracking heartbeat using stored external_campaign_id / budget only.
 */
export async function syncPaidCampaignStatus(
  campaignId: string,
): Promise<PaidAdsSyncResult> {
  const id = campaignId.trim();
  if (!id) {
    return { campaign_id: '-', ok: false, detail: 'campaign_id required' };
  }

  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_marketing_campaigns')
      .select('*')
      .eq('campaign_id', id)
      .maybeSingle();
    if (error) return { campaign_id: id, ok: false, detail: error.message };
    if (!data) return { campaign_id: id, ok: false, detail: 'Campaign not found' };

    const channel = String(data.channel ?? 'organic');
    if (channel !== 'paid') {
      return {
        campaign_id: id,
        ok: true,
        skipped: true,
        detail: 'Not a paid campaign',
      };
    }

    const externalId = (data.external_campaign_id as string) || null;
    const adPlatform = (data.ad_platform as string) || 'unknown';
    const budget = data.budget_k != null ? Number(data.budget_k) : null;

    if (!paidAdsLiveEnabled()) {
      const now = new Date().toISOString();
      await sb.from('os_marketing_analytics_events').insert({
        event_id: `PAD-${Date.now().toString(36)}`,
        kind: 'engagement',
        campaign_id: id,
        entity_id: (data.entity_id as string) ?? null,
        platform: adPlatform,
        metrics: {
          source: 'paid_stub',
          external_campaign_id: externalId,
          budget_k: budget,
          impression_source: 'paid_stub',
          impressions: 0,
          clicks: 0,
        },
        occurred_at: now,
      });
      return {
        campaign_id: id,
        ok: true,
        skipped: true,
        detail: `Stub sync · set MARKETING_PAID_ADS_LIVE=1 for ${adPlatform} API`,
        impressions: 0,
        clicks: 0,
        spend_k: budget ?? undefined,
      };
    }

    const adAccountId = (data.ad_account_id as string) || null;
    const { data: account } = adAccountId
      ? await sb
          .from('os_marketing_social_accounts')
          .select(
            'account_id, entity_id, platform, account_type, status, currency, external_account_id',
          )
          .eq('account_id', adAccountId)
          .maybeSingle()
      : { data: null };
    const expectedPlatform =
      adPlatform === 'linkedin_ads'
        ? 'linkedin'
        : adPlatform === 'meta_ads'
          ? 'facebook'
          : null;
    if (
      !adAccountId ||
      !account ||
      account.account_type !== 'paid_ads' ||
      account.status !== 'connected' ||
      account.platform !== expectedPlatform ||
      ((account.entity_id as string) ?? null) !==
        ((data.entity_id as string) ?? null)
    ) {
      return {
        campaign_id: id,
        ok: false,
        detail:
          'Paid sync requires a connected, provider-compatible ad account scoped to the campaign entity',
      };
    }
    const fresh = await ensureFreshAccessToken(adAccountId);
    if (!fresh.token) {
      return {
        campaign_id: id,
        ok: false,
        detail: fresh.error || 'Ad account token unavailable; reconnect OAuth',
      };
    }
    if (adPlatform === 'meta_ads') {
      return syncMetaAdsStub(
        id,
        externalId,
        data as Record<string, unknown>,
        fresh.token,
        (account.currency as string) || 'USD',
        adAccountId,
      );
    }
    if (adPlatform === 'linkedin_ads') {
      return syncLinkedInAdsStub(
        id,
        externalId,
        data as Record<string, unknown>,
        fresh.token,
        (account.currency as string) || 'USD',
        adAccountId,
      );
    }

    return {
      campaign_id: id,
      ok: false,
      detail: `No live connector for ad_platform=${adPlatform}`,
    };
  } catch (e) {
    return {
      campaign_id: id,
      ok: false,
      detail: e instanceof Error ? e.message : 'sync failed',
    };
  }
}

async function syncMetaAdsStub(
  campaignId: string,
  externalId: string | null,
  row: Record<string, unknown>,
  token: string,
  currency: string,
  adAccountId: string,
): Promise<PaidAdsSyncResult> {
  if (!externalId) {
    return {
      campaign_id: campaignId,
      ok: false,
      detail: 'external_campaign_id required',
    };
  }
  try {
    const version = process.env.META_API_VERSION?.trim() || 'v25.0';
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 29 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const params = new URLSearchParams({
      fields: 'impressions,clicks,spend,actions',
      time_range: JSON.stringify({ since: start, until: end }),
      time_increment: '1',
    });
    const res = await fetch(
      `https://graph.facebook.com/${version}/${encodeURIComponent(externalId)}/insights?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const json = (await res.json().catch(() => ({}))) as {
      data?: Array<{
        impressions?: string;
        clicks?: string;
        spend?: string;
      }>;
      error?: { message?: string };
    };
    if (!res.ok || json.error) {
      return {
        campaign_id: campaignId,
        ok: false,
        detail: json.error?.message || `Meta Ads HTTP ${res.status}`,
      };
    }
    const totals = (json.data ?? []).reduce(
      (sum, insight) => ({
        impressions: sum.impressions + Number(insight.impressions ?? 0),
        clicks: sum.clicks + Number(insight.clicks ?? 0),
        spend: sum.spend + Number(insight.spend ?? 0),
      }),
      { impressions: 0, clicks: 0, spend: 0 },
    );
    const { impressions, clicks, spend } = totals;
    const budgetK = Number(row.budget_k ?? 0);
    const sb = await createPersistClient();
    const eventId = `PAD-META-${campaignId}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
    await sb.from('os_marketing_analytics_events').upsert({
      event_id: eventId,
      kind: 'engagement',
      campaign_id: campaignId,
      entity_id: (row.entity_id as string) ?? null,
      platform: 'meta_ads',
      metrics: {
        source: 'paid_api',
        impression_source: 'meta_ads',
        external_campaign_id: externalId,
        ad_account_id: adAccountId,
        impressions,
        clicks,
        spend,
        currency,
        cpc: clicks > 0 ? spend / clicks : null,
        cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
        budget_utilization:
          budgetK > 0 ? spend / 1000 / budgetK : null,
        revenue_k: Number(row.attributed_revenue_k ?? 0),
        reporting_start: start,
        reporting_end: end,
      },
      occurred_at: new Date().toISOString(),
    }, { onConflict: 'event_id' });
    return {
      campaign_id: campaignId,
      ok: true,
      detail: `Meta Ads · ${impressions} impr · ${clicks} clicks`,
      impressions,
      clicks,
      spend_k: spend / 1000,
    };
  } catch (e) {
    return {
      campaign_id: campaignId,
      ok: false,
      detail: e instanceof Error ? e.message : 'Meta Ads sync failed',
    };
  }
}

async function syncLinkedInAdsStub(
  campaignId: string,
  externalId: string | null,
  row: Record<string, unknown>,
  token: string,
  currency: string,
  adAccountId: string,
): Promise<PaidAdsSyncResult> {
  if (!externalId) {
    return {
      campaign_id: campaignId,
      ok: false,
      detail: 'external_campaign_id required',
    };
  }
  try {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 30);
    const datePart = (d: Date) =>
      `(year:${d.getUTCFullYear()},month:${d.getUTCMonth() + 1},day:${d.getUTCDate()})`;
    const campaignUrn = externalId.startsWith('urn:')
      ? externalId
      : `urn:li:sponsoredCampaign:${externalId}`;
    const params = new URLSearchParams({
      q: 'analytics',
      pivot: 'CAMPAIGN',
      timeGranularity: 'ALL',
      dateRange: `(start:${datePart(start)},end:${datePart(end)})`,
      campaigns: `List(${campaignUrn})`,
      fields:
        'impressions,clicks,costInLocalCurrency,externalWebsiteConversions',
    });
    const res = await fetch(
      `https://api.linkedin.com/rest/adAnalytics?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'LinkedIn-Version':
            process.env.LINKEDIN_API_VERSION?.trim() || '202607',
          'X-Restli-Protocol-Version': '2.0.0',
        },
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      elements?: Array<{
        impressions?: number;
        clicks?: number;
        costInLocalCurrency?: string | number;
        externalWebsiteConversions?: number;
      }>;
      message?: string;
      code?: string;
    };
    if (!res.ok) {
      return {
        campaign_id: campaignId,
        ok: false,
        detail:
          json.message ||
          json.code ||
          `LinkedIn Ads HTTP ${res.status}`,
      };
    }
    const totals = (json.elements ?? []).reduce<{
      impressions: number;
      clicks: number;
      spend: number;
      conversions: number;
    }>(
      (sum, insight) => ({
        impressions: sum.impressions + Number(insight.impressions ?? 0),
        clicks: sum.clicks + Number(insight.clicks ?? 0),
        spend:
          sum.spend + Number(insight.costInLocalCurrency ?? 0),
        conversions:
          sum.conversions +
          Number(insight.externalWebsiteConversions ?? 0),
      }),
      { impressions: 0, clicks: 0, spend: 0, conversions: 0 },
    );
    const { impressions, clicks, spend, conversions } = totals;
    const revenueK = Number(row.attributed_revenue_k ?? 0);
    const budgetK = Number(row.budget_k ?? 0);
    const now = new Date();
    const eventId = `PAD-LI-${campaignId}-${now.toISOString().slice(0, 10).replaceAll('-', '')}`;
    const sb = await createPersistClient();
    const { error } = await sb.from('os_marketing_analytics_events').upsert(
      {
        event_id: eventId,
        kind: 'engagement',
        campaign_id: campaignId,
        entity_id: (row.entity_id as string) ?? null,
        platform: 'linkedin_ads',
        metrics: {
          source: 'paid_api',
          impression_source: 'linkedin_ads',
          external_campaign_id: externalId,
          ad_account_id: adAccountId,
          impressions,
          clicks,
          conversions,
          spend,
          currency,
          cpc: clicks > 0 ? spend / clicks : null,
          cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
          conversion_rate:
            clicks > 0 ? conversions / clicks : null,
          cpa: conversions > 0 ? spend / conversions : null,
          budget_utilization:
            budgetK > 0 ? spend / 1000 / budgetK : null,
          revenue_k: revenueK,
          period_days: 30,
          reporting_start: start.toISOString().slice(0, 10),
          reporting_end: end.toISOString().slice(0, 10),
          revenue_period: 'campaign_attributed',
        },
        occurred_at: now.toISOString(),
      },
      { onConflict: 'event_id' },
    );
    if (error) {
      return {
        campaign_id: campaignId,
        ok: false,
        detail: `LinkedIn insights saved failed: ${error.message}`,
      };
    }
    return {
      campaign_id: campaignId,
      ok: true,
      detail: `LinkedIn Ads · ${impressions} impr · ${clicks} clicks · ${conversions} conversions`,
      impressions,
      clicks,
      spend_k: spend / 1000,
    };
  } catch (e) {
    return {
      campaign_id: campaignId,
      ok: false,
      detail: e instanceof Error ? e.message : 'LinkedIn Ads sync failed',
    };
  }
}

export async function listPaidCampaigns(limit = 30): Promise<{
  rows: MarketingCampaign[];
  error?: string;
}> {
  try {
    const { listCampaigns } = await import(
      '@/lib/shared-services/marketing-repo'
    );
    const all = await listCampaigns(Math.max(limit * 3, 60));
    return {
      rows: all.rows.filter((c) => c.channel === 'paid').slice(0, limit),
      error: all.error,
    };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : 'list failed',
    };
  }
}

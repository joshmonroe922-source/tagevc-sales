/**
 * Paid media campaign stubs / tracking foundation (Phase 30).
 * Live ad-network APIs remain opt-in behind MARKETING_PAID_ADS_LIVE=1.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import type { MarketingCampaign } from '@/lib/shared-services/marketing-types';

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

    // Live connectors (Phase 30 foundation): Meta/LinkedIn Ads via env tokens
    if (adPlatform.includes('meta') || adPlatform.includes('facebook')) {
      return syncMetaAdsStub(id, externalId, data as Record<string, unknown>);
    }
    if (adPlatform.includes('linkedin')) {
      return syncLinkedInAdsStub(id, externalId, data as Record<string, unknown>);
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
): Promise<PaidAdsSyncResult> {
  const token = process.env.META_ADS_ACCESS_TOKEN?.trim();
  if (!token || !externalId) {
    return {
      campaign_id: campaignId,
      ok: false,
      detail: 'META_ADS_ACCESS_TOKEN + external_campaign_id required',
    };
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${encodeURIComponent(externalId)}/insights?fields=impressions,clicks,spend&access_token=${encodeURIComponent(token)}`,
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
    const row0 = json.data?.[0];
    const impressions = Number(row0?.impressions ?? 0);
    const clicks = Number(row0?.clicks ?? 0);
    const spend = Number(row0?.spend ?? 0);
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
        impressions,
        clicks,
        spend,
        revenue_k: Number(row.attributed_revenue_k ?? 0),
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
): Promise<PaidAdsSyncResult> {
  const token = process.env.LINKEDIN_ADS_ACCESS_TOKEN?.trim();
  if (!token || !externalId) {
    return {
      campaign_id: campaignId,
      ok: false,
      detail: 'LINKEDIN_ADS_ACCESS_TOKEN + external_campaign_id required',
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
            process.env.LINKEDIN_API_VERSION?.trim() || '202506',
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
    const insight = json.elements?.[0];
    const impressions = Number(insight?.impressions ?? 0);
    const clicks = Number(insight?.clicks ?? 0);
    const spend = Number(insight?.costInLocalCurrency ?? 0);
    const conversions = Number(insight?.externalWebsiteConversions ?? 0);
    const revenueK = Number(row.attributed_revenue_k ?? 0);
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
          impressions,
          clicks,
          conversions,
          spend,
          revenue_k: revenueK,
          period_days: 30,
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

import Link from 'next/link';
import { MarketingClient } from '@/components/shared-services/marketing-client';
import { Badge } from '@/components/ui/badge';
import { listBrandVoices } from '@/lib/shared-services/marketing-brand';
import { getMarketingAnalyticsSummary } from '@/lib/shared-services/marketing-analytics';
import {
  getMarketingFoundationStatus,
  listCampaigns,
  listContent,
  listGenerationJobs,
  listScheduleJobs,
  listSocialAccounts,
} from '@/lib/shared-services/marketing-repo';
import { roleHasPermission } from '@/lib/types/roles';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';

export default async function MarketingModulePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission('read:marketing');

  const sp = (await searchParams) ?? {};
  const oauthFlash =
    typeof sp.oauth === 'string'
      ? sp.oauth === 'connected'
        ? 'OAuth connected'
        : sp.oauth === 'stub'
          ? 'Stub-connected (OAuth apps not configured)'
          : sp.oauth === 'error'
            ? `OAuth error: ${typeof sp.detail === 'string' ? sp.detail : 'failed'}`
            : null
      : null;

  const [
    campaigns,
    content,
    accounts,
    scheduleJobs,
    generationJobs,
    voices,
    analytics,
  ] = await Promise.all([
    listCampaigns(),
    listContent(),
    listSocialAccounts(),
    listScheduleJobs(),
    listGenerationJobs(),
    listBrandVoices(),
    getMarketingAnalyticsSummary({ limit: 200 }),
  ]);

  const ctx = await getSessionContext();
  const canWrite = ctx
    ? roleHasPermission(ctx.profile.role, 'write:marketing')
    : false;

  const tableError =
    campaigns.error ||
    content.error ||
    accounts.error ||
    scheduleJobs.error ||
    generationJobs.error ||
    voices.error;

  return (
    <div className="space-y-6">
      <Link
        href="/shared-services"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Shared Services
      </Link>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Marketing</Badge>
          <Badge variant="secondary">Phase 29</Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Multichannel Marketing
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          TikTok OAuth, paid campaign stubs, SLA assignee routing, and live
          engagement across LinkedIn, Meta, X, YouTube, and TikTok.
        </p>
        {oauthFlash && (
          <p className="text-sm text-emerald-700">{oauthFlash}</p>
        )}
      </div>

      <MarketingClient
        campaigns={campaigns.rows}
        content={content.rows}
        accounts={accounts.rows}
        scheduleJobs={scheduleJobs.rows}
        generationJobs={generationJobs.rows}
        brandVoices={voices.rows}
        analytics={analytics.summary}
        analyticsError={analytics.error}
        canWrite={canWrite}
        tableError={tableError}
        foundation={getMarketingFoundationStatus()}
      />
    </div>
  );
}

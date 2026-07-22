import Link from 'next/link';
import { MarketingClient } from '@/components/shared-services/marketing-client';
import { MarketingRevenuePhase41 } from '@/components/shared-services/marketing-revenue-phase41';
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
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import { listPaidMetricOperations } from '@/lib/shared-services/marketing-paid-backfill';
import { getPaidAttributionReport } from '@/lib/shared-services/marketing-attribution';
import { getPhase41RevenueReport } from '@/lib/shared-services/marketing-phase41';
import { getPhase42RevenueSloReport } from '@/lib/shared-services/marketing-phase42';
import { getPhase43RevenueOpsReport } from '@/lib/shared-services/marketing-phase43';
import { getPhase44RevenueOpsReport } from '@/lib/shared-services/marketing-phase44';
import { getPhase45RevenueOpsReport } from '@/lib/shared-services/marketing-phase45';

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
          : sp.oauth === 'select_account'
            ? 'OAuth grant saved — use Discover / select on the paid account'
          : sp.oauth === 'error'
            ? `OAuth error: ${typeof sp.detail === 'string' ? sp.detail : 'failed'}`
            : null
      : null;
  const paidDaysRaw =
    typeof sp.paid_days === 'string' ? Number(sp.paid_days) : 30;
  const paidDays: 7 | 30 | 90 =
    paidDaysRaw === 7 || paidDaysRaw === 90 ? paidDaysRaw : 30;
  const ctx = await getSessionContext();
  const firmWide = ctx
    ? isFirmWideAccess(ctx.profile.role, ctx.profile.entity_id)
    : false;

  const [
    campaigns,
    content,
    accounts,
    scheduleJobs,
    generationJobs,
    voices,
    analytics,
    paidOperations,
    attribution,
    authoritativeRevenue,
    productionSlos,
    opsReport,
    phase44OpsReport,
    phase45OpsReport,
  ] = await Promise.all([
    listCampaigns(
      50,
      firmWide ? null : (ctx?.profile.entity_id ?? null),
    ),
    listContent(),
    listSocialAccounts(
      50,
      firmWide ? null : (ctx?.profile.entity_id ?? null),
    ),
    listScheduleJobs(),
    listGenerationJobs(),
    listBrandVoices(),
    getMarketingAnalyticsSummary({
      limit: 200,
      paidDays,
      entityId: firmWide ? null : (ctx?.profile.entity_id ?? null),
    }),
    listPaidMetricOperations({
      entityId: ctx?.profile.entity_id ?? null,
      firmWide,
    }),
    getPaidAttributionReport({
      entityId: firmWide ? null : (ctx?.profile.entity_id ?? null),
      firmWide,
      days: paidDays,
    }),
    getPhase41RevenueReport({
      entityId: firmWide ? null : (ctx?.profile.entity_id ?? null),
      firmWide,
      days: paidDays,
    }),
    getPhase42RevenueSloReport({
      entityId: firmWide ? null : (ctx?.profile.entity_id ?? null),
      firmWide,
      days: paidDays,
    }),
    getPhase43RevenueOpsReport({
      entityId: firmWide ? null : (ctx?.profile.entity_id ?? null),
      firmWide,
      days: paidDays,
    }),
    getPhase44RevenueOpsReport({
      entityId: firmWide ? null : (ctx?.profile.entity_id ?? null),
      firmWide,
      days: paidDays,
    }),
    getPhase45RevenueOpsReport({
      entityId: firmWide ? null : (ctx?.profile.entity_id ?? null),
      firmWide,
      days: paidDays,
    }),
  ]);
  if (!firmWide && ctx?.profile.entity_id) {
    const entityId = ctx.profile.entity_id;
    campaigns.rows = campaigns.rows.filter(
      (row) => row.entity_id === entityId,
    );
    content.rows = content.rows.filter((row) => row.entity_id === entityId);
    accounts.rows = accounts.rows.filter((row) => row.entity_id === entityId);
    scheduleJobs.rows = scheduleJobs.rows.filter(
      (row) => row.entity_id === entityId,
    );
    generationJobs.rows = generationJobs.rows.filter(
      (row) => row.entity_id === entityId,
    );
    voices.rows = voices.rows.filter((row) => row.entity_id === entityId);
  }

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
          <Badge variant="secondary">Phase 45</Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Multichannel Marketing
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Entity-bound paid delivery, production ledger authenticity, tuned
          fail-closed auto-reject rules, attribution conflict tracking,
          webhook delivery SLOs, and correction workflow monitoring over
          authoritative evidence.
        </p>
        {oauthFlash && (
          <p className="text-sm text-emerald-700">{oauthFlash}</p>
        )}
      </div>

      <MarketingRevenuePhase41
        report={authoritativeRevenue.report}
        error={authoritativeRevenue.error}
        canWrite={canWrite}
        sloReport={productionSlos.report}
        sloError={productionSlos.error}
        opsReport={opsReport.report}
        opsError={opsReport.error}
        phase44OpsReport={phase44OpsReport.report}
        phase44OpsError={phase44OpsReport.error}
        phase45OpsReport={phase45OpsReport.report}
        phase45OpsError={phase45OpsReport.error}
      />

      <MarketingClient
        campaigns={campaigns.rows}
        content={content.rows}
        accounts={accounts.rows}
        scheduleJobs={scheduleJobs.rows}
        generationJobs={generationJobs.rows}
        brandVoices={voices.rows}
        analytics={analytics.summary}
        paidOperations={paidOperations}
        attribution={attribution.report}
        analyticsError={analytics.error || attribution.error}
        canWrite={canWrite}
        tableError={tableError}
        foundation={getMarketingFoundationStatus()}
      />
    </div>
  );
}

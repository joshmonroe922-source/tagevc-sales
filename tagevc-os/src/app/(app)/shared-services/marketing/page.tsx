import Link from 'next/link';
import { MarketingClient } from '@/components/shared-services/marketing-client';
import { Badge } from '@/components/ui/badge';
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

export default async function MarketingModulePage() {
  await requirePermission('read:marketing');

  const [campaigns, content, accounts, scheduleJobs, generationJobs] =
    await Promise.all([
      listCampaigns(),
      listContent(),
      listSocialAccounts(),
      listScheduleJobs(),
      listGenerationJobs(),
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
    generationJobs.error;

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
          <Badge variant="secondary">Phase 22 foundation</Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Multichannel Marketing
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Centralized campaigns and content for Tage VC and subsidiaries.
          AI generation and social posting automation land in later phases —
          this surface establishes the data model and pluggable frameworks.
        </p>
      </div>

      <MarketingClient
        campaigns={campaigns.rows}
        content={content.rows}
        accounts={accounts.rows}
        scheduleJobs={scheduleJobs.rows}
        generationJobs={generationJobs.rows}
        canWrite={canWrite}
        tableError={tableError}
        foundation={getMarketingFoundationStatus()}
      />
    </div>
  );
}

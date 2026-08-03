import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { loadIntelligenceDashboard } from '@/lib/campaign/intelligence';
import { IntelligenceClient } from '@/components/campaign/intelligence-client';

export default async function Page() {
  await requirePermission('read:marketing');
  const ctx = await getSessionContext();
  const entityId = ctx?.profile.entity_id || 'ENT-FIRM';
  const data = await loadIntelligenceDashboard(entityId);
  return <IntelligenceClient initial={data} />;
}

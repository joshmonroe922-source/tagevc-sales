import { CampaignBuilderClient } from '@/components/campaign/ecc-home';
import { listLists, listTemplates } from '@/lib/campaign/db/repo';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';
export default async function Page() {
  await requirePermission('read:marketing');
  const ctx = await getSessionContext();
  const entityId = ctx?.profile.entity_id || 'ENT-FIRM';
  const [lists, templates] = await Promise.all([listLists(entityId), listTemplates(entityId)]);
  return (<div className="space-y-4"><h2 className="font-heading text-xl font-semibold text-[#3a414f]">New campaign</h2><CampaignBuilderClient lists={lists} templates={templates} /></div>);
}

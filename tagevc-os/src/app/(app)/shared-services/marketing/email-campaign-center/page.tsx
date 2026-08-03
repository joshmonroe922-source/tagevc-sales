import { EccHomeClient } from '@/components/campaign/ecc-home';
import { getEccHome } from '@/lib/campaign/home';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';

export default async function Page() {
  await requirePermission('read:marketing');
  const ctx = await getSessionContext();
  const entityId = ctx?.profile.entity_id || 'ENT-FIRM';
  const home = await getEccHome(entityId, ctx?.profile.id || '00000000-0000-0000-0000-000000000001', true);
  return <EccHomeClient home={home} />;
}

import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { getEntitySettings } from '@/lib/campaign/auth';

export default async function Page() {
  await requirePermission('read:marketing');
  const ctx = await getSessionContext();
  const entityId = ctx?.profile.entity_id || 'ENT-FIRM';
  const settings = await getEntitySettings(entityId);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-xl font-semibold text-[#3a414f]">Settings</h2>
        <p className="text-sm text-muted-foreground">Entity campaign flags · compliance address · mutex policy.</p>
      </div>
      <div className="rounded-lg border border-[#d7d3c3] bg-white p-4 text-sm space-y-2">
        <p>Entity: <strong>{entityId}</strong></p>
        <p>Campaign enabled: {String(settings.campaign_enabled)}</p>
        <p>Kill switch: {String(settings.kill_switch)}</p>
        <p>Physical address: {settings.physical_address || '—'}</p>
        <p className="text-muted-foreground">Contact admin to update entity settings · ECC_ENABLED env gates the service globally.</p>
      </div>
    </div>
  );
}

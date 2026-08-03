import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { getEntitySettings } from '@/lib/campaign/auth';
import { campaignDb } from '@/lib/campaign/db/client';

export default async function Page() {
  await requirePermission('read:marketing');
  const ctx = await getSessionContext();
  const entityId = ctx?.profile.entity_id || 'ENT-FIRM';
  const [settings, domains, suppressions] = await Promise.all([
    getEntitySettings(entityId),
    campaignDb().then((sb) => sb.from('ecc_sending_domains').select('domain, status').eq('entity_id', entityId)),
    campaignDb().then((sb) => sb.from('ecc_suppressions').select('id', { count: 'exact', head: true }).eq('entity_id', entityId)),
  ]);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-xl font-semibold text-[#3a414f]">Deliverability</h2>
        <p className="text-sm text-muted-foreground">Domains · suppressions · owned MTA readiness.</p>
      </div>
      <div className="rounded-lg border border-[#d7d3c3] bg-white p-4 text-sm space-y-2">
        <p>Entity: <strong>{entityId}</strong></p>
        <p>Kill switch: {String(settings.kill_switch)} · Suppressed addresses: {suppressions.count ?? 0}</p>
        <p>Physical address: {settings.physical_address || '—'}</p>
        <p className="text-muted-foreground">Postal/owned MTA activates when POSTAL_API_URL + POSTAL_API_KEY are set. Day-1 bulk uses controlled Graph + Reply-To + tracking.</p>
      </div>
      <div className="rounded-lg border border-[#d7d3c3] bg-white p-4">
        <h3 className="font-heading mb-2 text-[#3a414f]">Sending domains</h3>
        {(domains.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No domains configured</p>
        ) : (
          <ul className="divide-y divide-[#ece9e6] text-sm">
            {(domains.data ?? []).map((d: { domain: string; status: string }) => (
              <li key={d.domain} className="flex justify-between py-2">
                <span>{d.domain}</span>
                <span className="text-xs text-muted-foreground">{d.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

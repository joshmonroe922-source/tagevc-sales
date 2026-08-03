import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { campaignDb } from '@/lib/campaign/db/client';

export default async function Page() {
  await requirePermission('read:marketing');
  const ctx = await getSessionContext();
  const entityId = ctx?.profile.entity_id || 'ENT-FIRM';
  const sb = await campaignDb();
  const { data } = await sb.from('ecc_journeys').select('*').eq('entity_id', entityId).order('updated_at', { ascending: false });
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-xl font-semibold text-[#3a414f]">Sequences</h2>
        <p className="text-sm text-muted-foreground">Mutex groups · per-step Graph/MTA · call_vm_email via dialer hooks.</p>
      </div>
      {(data ?? []).length === 0 ? (
        <p className="rounded-lg border border-[#d7d3c3] bg-white px-4 py-8 text-center text-sm text-muted-foreground">No journeys configured</p>
      ) : (
        <pre className="overflow-auto rounded border border-[#d7d3c3] bg-white p-3 text-xs">{JSON.stringify(data, null, 2)}</pre>
      )}
    </div>
  );
}

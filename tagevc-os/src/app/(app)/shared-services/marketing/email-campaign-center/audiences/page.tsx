import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { listLists } from '@/lib/campaign/db/repo';
import { ListActionBar } from '@/components/campaign/list-action-bar';

export default async function Page() {
  await requirePermission('read:marketing');
  const ctx = await getSessionContext();
  const entityId = ctx?.profile.entity_id || 'ENT-FIRM';
  const lists = await listLists(entityId);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-xl font-semibold text-[#3a414f]">Audiences</h2>
        <p className="text-sm text-muted-foreground">Lists drive blast audiences · Power Dialer · attach-to-campaign.</p>
      </div>
      {lists.length === 0 ? (
        <p className="rounded-lg border border-[#d7d3c3] bg-white px-4 py-8 text-center text-sm text-muted-foreground">No lists yet</p>
      ) : (
        lists.map((l: { id: string; name: string; count_cached?: number }) => (
          <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#d7d3c3] bg-white px-4 py-3">
            <div>
              <p className="font-medium text-[#3a414f]">{l.name}</p>
              <p className="text-xs text-muted-foreground">{l.count_cached ?? 0} contacts</p>
            </div>
            <ListActionBar listId={l.id} listName={l.name} />
          </div>
        ))
      )}
    </div>
  );
}

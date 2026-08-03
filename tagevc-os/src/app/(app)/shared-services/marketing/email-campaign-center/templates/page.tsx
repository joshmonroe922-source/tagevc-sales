import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { listTemplates } from '@/lib/campaign/db/repo';

export default async function Page() {
  await requirePermission('read:marketing');
  const ctx = await getSessionContext();
  const entityId = ctx?.profile.entity_id || 'ENT-FIRM';
  const templates = await listTemplates(entityId);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-xl font-semibold text-[#3a414f]">Templates</h2>
        <p className="text-sm text-muted-foreground">Reusable HTML with merge fields · compliance footer injected at send.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {templates.length === 0 ? (
          <p className="col-span-full rounded-lg border border-[#d7d3c3] bg-white px-4 py-8 text-center text-sm text-muted-foreground">No templates yet</p>
        ) : (
          templates.map((t: { id: string; name: string; subject?: string; category?: string }) => (
            <article key={t.id} className="rounded-lg border border-[#d7d3c3] bg-white p-4">
              <p className="text-xs uppercase text-muted-foreground">{t.category || 'general'}</p>
              <h3 className="font-heading mt-1 text-[#3a414f]">{t.name}</h3>
              <p className="text-sm text-muted-foreground">{t.subject}</p>
            </article>
          ))
        )}
      </div>
    </div>
  );
}

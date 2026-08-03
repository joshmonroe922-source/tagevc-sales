import { notFound } from 'next/navigation';
import { CampaignBuilderClient } from '@/components/campaign/ecc-home';
import { getCampaign, getRecipients, listLists, listTemplates } from '@/lib/campaign/db/repo';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { CampaignDetailActions } from '@/components/campaign/campaign-detail-actions';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('read:marketing');
  const { id } = await params;
  const ctx = await getSessionContext();
  const entityId = ctx?.profile.entity_id || 'ENT-FIRM';
  const campaign = await getCampaign(entityId, id);
  if (!campaign) notFound();
  const [lists, templates, recipients] = await Promise.all([listLists(entityId), listTemplates(entityId), getRecipients(id)]);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold text-[#3a414f]">{campaign.name}</h2>
          <p className="text-sm text-muted-foreground">Status: {campaign.status} · {campaign.delivery_plane}</p>
        </div>
        <CampaignDetailActions campaignId={campaign.id} status={campaign.status} replyTo={ctx?.profile.email || ''} />
      </div>
      <CampaignBuilderClient lists={lists} templates={templates} initial={campaign} />
      <section>
        <h3 className="font-heading mb-2 text-lg text-[#3a414f]">People</h3>
        <div className="overflow-hidden rounded-lg border border-[#d7d3c3]">
          <table className="w-full text-sm">
            <thead className="bg-[#ece9e6]/70 text-xs"><tr><th className="px-3 py-2 text-left">Email</th><th className="px-3 py-2 text-left">Opens</th><th className="px-3 py-2 text-left">Clicks</th><th className="px-3 py-2 text-left">Score</th></tr></thead>
            <tbody>
              {recipients.length === 0 ? <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Send to populate</td></tr> :
                recipients.map((r: any) => (
                  <tr key={r.contact_id} className="border-t border-[#ece9e6]">
                    <td className="px-3 py-2">{r.email}</td><td className="px-3 py-2">{r.open_count}</td><td className="px-3 py-2">{r.click_count}</td><td className="px-3 py-2">{r.score}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

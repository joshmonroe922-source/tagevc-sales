import { requireCampaignAuth } from '@/lib/campaign/auth';
import { campaignDb } from '@/lib/campaign/db/client';
import { jsonError, jsonOk, readJson } from '@/lib/campaign/http';

type Ctx = { params: Promise<{ id: string }> };

/** Snapshot list membership and hand off to dialer spine (stub queue row). */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id: listId } = await ctx.params;
    const auth = await requireCampaignAuth();
    const body = await readJson<{
      owner_id?: string;
      sequence_id?: string;
      vm_asset_id?: string;
      paired_email_template_id?: string;
    }>(req);
    const sb = await campaignDb();
    const { data: members } = await sb
      .from('ecc_list_members')
      .select('contact_id')
      .eq('list_id', listId);
    const contactIds = (members ?? []).map((m) => m.contact_id);
    // Snapshot list so filter drift cannot change mid-run
    const { data: snap } = await sb
      .from('ecc_lists')
      .insert({
        entity_id: auth.entityId,
        name: `Dialer snapshot ${new Date().toISOString().slice(0, 16)}`,
        list_type: 'snapshot',
        count_cached: contactIds.length,
        created_by: auth.userId,
        description: `snapshot of ${listId}`,
      })
      .select('id')
      .single();
    if (snap?.id && contactIds.length) {
      await sb.from('ecc_list_members').upsert(
        contactIds.map((contact_id) => ({
          list_id: snap.id,
          contact_id,
          source: 'dialer_snapshot',
        })),
      );
    }
    await sb.from('ecc_audit_log').insert({
      entity_id: auth.entityId,
      actor_id: auth.userId,
      action: 'list.power_dialer',
      object_type: 'list',
      object_id: listId,
      after_json: {
        snapshot_list_id: snap?.id,
        count: contactIds.length,
        owner_id: body.owner_id || auth.userId,
        sequence_id: body.sequence_id || null,
        vm_asset_id: body.vm_asset_id || null,
        paired_email_template_id: body.paired_email_template_id || null,
        dialer_status: 'queued_stub',
      },
    });
    return jsonOk({
      data: {
        queued: contactIds.length,
        snapshot_list_id: snap?.id,
        dialer: 'stub_handoff',
      },
    });
  } catch (e) {
    return jsonError('ERROR', e instanceof Error ? e.message : 'error', 400);
  }
}

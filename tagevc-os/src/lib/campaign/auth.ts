import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import { createPersistClient } from '@/lib/supabase/persist-client';

export type CampaignAuth = {
  userId: string; entityId: string; role: string; firmWide: boolean;
  permissions: { marketer: boolean; approver: boolean; admin: boolean; viewTeam: boolean; viewEntity: boolean };
};

export async function requireCampaignAuth(opts?: { entityOverride?: string | null }): Promise<CampaignAuth> {
  await requirePermission('read:marketing');
  const ctx = await getSessionContext();
  if (!ctx) throw new Error('Unauthorized');
  const firmWide = isFirmWideAccess(ctx.profile.role, ctx.profile.entity_id);
  const entityId = (firmWide && opts?.entityOverride?.trim()) || ctx.profile.entity_id || 'ENT-FIRM';
  const role = ctx.profile.role;
  const elevated = ['visionary','think_tank','partner','coo','sub_lead','service_lead','admin','ssc_marketing'].includes(role);
  return {
    userId: ctx.profile.id, entityId, role, firmWide,
    permissions: {
      marketer: elevated,
      approver: ['visionary','think_tank','partner','coo','sub_lead','service_lead','admin'].includes(role),
      admin: ['visionary','think_tank','admin','service_lead'].includes(role),
      viewTeam: elevated,
      viewEntity: firmWide || elevated,
    },
  };
}

export async function isCampaignEnabled(entityId: string): Promise<boolean> {
  if (process.env.ECC_ENABLED === '0') return false;
  try {
    const sb = await createPersistClient({ mode: 'service' });
    const { data } = await sb.from('ecc_entity_settings').select('campaign_enabled, kill_switch').eq('entity_id', entityId).maybeSingle();
    if (!data) return true;
    return Boolean(data.campaign_enabled) && !data.kill_switch;
  } catch { return process.env.ECC_ENABLED !== '0'; }
}

export async function getEntitySettings(entityId: string) {
  const sb = await createPersistClient({ mode: 'service' });
  const { data } = await sb.from('ecc_entity_settings').select('*').eq('entity_id', entityId).maybeSingle();
  return data ?? { entity_id: entityId, campaign_enabled: true, kill_switch: false, physical_address: 'Tage Venture Capital — San Diego, CA' };
}

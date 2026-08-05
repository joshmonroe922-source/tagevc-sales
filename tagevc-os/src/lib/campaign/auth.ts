import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import { campaignDb } from '@/lib/campaign/db/client';

export type CampaignAuth = {
  userId: string;
  entityId: string;
  role: string;
  firmWide: boolean;
  permissions: {
    marketer: boolean;
    approver: boolean;
    admin: boolean;
    viewTeam: boolean;
    viewEntity: boolean;
  };
};

function serviceTokenFromEnv(): string | null {
  const token =
    process.env.TAGE_CAMPAIGN_API_TOKEN?.trim() ||
    process.env.TAGE_ECC_API_SECRET?.trim() ||
    process.env.ECC_API_SECRET?.trim() ||
    '';
  return token || null;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

/**
 * Session cookie auth, or Recruit 619 → spine service token
 * (`TAGE_CAMPAIGN_API_TOKEN` / `TAGE_ECC_API_SECRET` + `x-entity-id`).
 */
export async function requireCampaignAuth(req?: Request): Promise<CampaignAuth> {
  const expected = serviceTokenFromEnv();
  if (req && expected) {
    const got = bearerToken(req);
    if (got && got === expected) {
      const entityId =
        req.headers.get('x-entity-id')?.trim() || 'ENT-FIRM';
      return {
        userId: 'service:campaign-api',
        entityId,
        role: 'service',
        firmWide: true,
        permissions: {
          marketer: true,
          approver: true,
          admin: true,
          viewTeam: true,
          viewEntity: true,
        },
      };
    }
  }

  await requirePermission('read:marketing');
  const ctx = await getSessionContext();
  if (!ctx) throw new Error('Unauthorized');
  const firmWide = isFirmWideAccess(ctx.profile.role, ctx.profile.entity_id);
  const entityOverride = req?.headers.get('x-entity-id')?.trim();
  const entityId =
    (firmWide && entityOverride) || ctx.profile.entity_id || 'ENT-FIRM';
  const role = ctx.profile.role;
  const elevated = [
    'visionary',
    'think_tank',
    'partner',
    'coo',
    'sub_lead',
    'service_lead',
    'admin',
    'ssc_marketing',
  ].includes(role);
  return {
    userId: ctx.profile.id,
    entityId,
    role,
    firmWide,
    permissions: {
      marketer: elevated,
      approver: [
        'visionary',
        'think_tank',
        'partner',
        'coo',
        'sub_lead',
        'service_lead',
        'admin',
      ].includes(role),
      admin: ['visionary', 'think_tank', 'admin', 'service_lead'].includes(role),
      viewTeam: elevated,
      viewEntity: firmWide || elevated,
    },
  };
}

export async function getEntitySettings(entityId: string) {
  try {
    const sb = await campaignDb();
    const { data } = await sb
      .from('ecc_entity_settings')
      .select('*')
      .eq('entity_id', entityId)
      .maybeSingle();
    return (
      data ?? {
        entity_id: entityId,
        campaign_enabled: true,
        kill_switch: false,
        mutex_policy_json: {},
      }
    );
  } catch {
    return {
      entity_id: entityId,
      campaign_enabled: true,
      kill_switch: false,
      mutex_policy_json: {},
    };
  }
}

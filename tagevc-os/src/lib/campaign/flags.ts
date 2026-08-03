/**
 * Email Campaign Center feature flags + entity settings.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';

export async function isCampaignEnabled(entityId: string): Promise<boolean> {
  if (process.env.ECC_ENABLED === '0') return false;
  try {
    const sb = await createPersistClient({ mode: 'service' });
    const { data } = await sb
      .from('ecc_entity_settings')
      .select('campaign_enabled, kill_switch')
      .eq('entity_id', entityId)
      .maybeSingle();
    if (!data) return true; // fail-open for pilot until settings seeded
    return Boolean(data.campaign_enabled) && !Boolean(data.kill_switch);
  } catch {
    return process.env.ECC_ENABLED !== '0';
  }
}

export async function getEntitySettings(entityId: string) {
  const sb = await createPersistClient({ mode: 'service' });
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
      default_permission: 'opted_in',
      quiet_hours_json: { start: 21, end: 8 },
      frequency_cap_json: { per_7d: 7, per_30d: 20 },
      mutex_policy_json: { global_max: 3, on_conflict: 'block' },
      require_domain_verified: false,
      physical_address: null,
      brand_kit_json: {},
    }
  );
}

export async function setKillSwitch(
  entityId: string,
  enabled: boolean,
): Promise<void> {
  const sb = await createPersistClient({ mode: 'service' });
  await sb.from('ecc_entity_settings').upsert({
    entity_id: entityId,
    kill_switch: enabled,
    updated_at: new Date().toISOString(),
  });
}

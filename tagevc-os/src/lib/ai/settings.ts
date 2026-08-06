import {
  claudeSelectableInSettings,
  orgDefaultProviderFromEnv,
} from '@/lib/ai/flags';
import { isAiProviderId, resolveAiProviderPreference } from '@/lib/ai/resolve';
import type { AiProviderId, ResolvedAiProvider } from '@/lib/ai/types';
import { createClient } from '@/lib/supabase/server';

export type AiOrgSettings = {
  entityId: string;
  defaultProvider: AiProviderId;
  claudeFeatureEnabled: boolean;
  source: 'db' | 'env' | 'platform';
};

export type AiUserPrefs = {
  userId: string;
  preferredProvider: AiProviderId | null;
  source: 'db' | 'none';
};

function missingRelation(error: { message?: string; code?: string } | null) {
  if (!error) return false;
  const msg = error.message ?? '';
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /os_ai_org_settings|os_ai_user_prefs|does not exist|schema cache/i.test(msg)
  );
}

export async function getAiOrgSettings(
  entityId: string,
): Promise<AiOrgSettings> {
  const envDefault = orgDefaultProviderFromEnv();
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('os_ai_org_settings')
      .select('entity_id, default_provider, claude_feature_enabled')
      .eq('entity_id', entityId)
      .maybeSingle();

    if (error && !missingRelation(error)) {
      console.warn('[ai:org-settings]', error.message);
    }

    if (data && isAiProviderId(data.default_provider)) {
      return {
        entityId,
        defaultProvider: data.default_provider,
        claudeFeatureEnabled: Boolean(data.claude_feature_enabled),
        source: 'db',
      };
    }
  } catch (e) {
    console.warn('[ai:org-settings]', e instanceof Error ? e.message : e);
  }

  if (envDefault) {
    return {
      entityId,
      defaultProvider: envDefault,
      claudeFeatureEnabled: false,
      source: 'env',
    };
  }

  return {
    entityId,
    defaultProvider: 'grok',
    claudeFeatureEnabled: false,
    source: 'platform',
  };
}

export async function getAiUserPrefs(userId: string): Promise<AiUserPrefs> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('os_ai_user_prefs')
      .select('user_id, preferred_provider')
      .eq('user_id', userId)
      .maybeSingle();

    if (error && !missingRelation(error)) {
      console.warn('[ai:user-prefs]', error.message);
    }

    if (data) {
      const preferred = isAiProviderId(data.preferred_provider)
        ? data.preferred_provider
        : null;
      return { userId, preferredProvider: preferred, source: 'db' };
    }
  } catch (e) {
    console.warn('[ai:user-prefs]', e instanceof Error ? e.message : e);
  }
  return { userId, preferredProvider: null, source: 'none' };
}

export async function resolveSessionAiProvider(opts: {
  userId: string;
  entityId: string;
}): Promise<ResolvedAiProvider & { claudeSelectable: boolean }> {
  const [org, user] = await Promise.all([
    getAiOrgSettings(opts.entityId),
    getAiUserPrefs(opts.userId),
  ]);
  const resolved = resolveAiProviderPreference({
    userPreferred: user.preferredProvider,
    orgDefault: org.defaultProvider,
  });
  return {
    ...resolved,
    claudeSelectable: claudeSelectableInSettings(org.claudeFeatureEnabled),
  };
}

export async function upsertAiUserPreferredProvider(opts: {
  userId: string;
  preferredProvider: AiProviderId | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from('os_ai_user_prefs').upsert(
    {
      user_id: opts.userId,
      preferred_provider: opts.preferredProvider,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) {
    if (missingRelation(error)) {
      return {
        ok: false,
        error:
          'AI prefs table missing — apply supabase/phase_ai_model_preference.sql',
      };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function upsertAiOrgSettings(opts: {
  entityId: string;
  defaultProvider: AiProviderId;
  claudeFeatureEnabled?: boolean;
  updatedBy?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from('os_ai_org_settings').upsert(
    {
      entity_id: opts.entityId,
      default_provider: opts.defaultProvider,
      claude_feature_enabled: opts.claudeFeatureEnabled ?? false,
      updated_at: new Date().toISOString(),
      updated_by: opts.updatedBy ?? null,
    },
    { onConflict: 'entity_id' },
  );
  if (error) {
    if (missingRelation(error)) {
      return {
        ok: false,
        error:
          'AI org settings table missing — apply supabase/phase_ai_model_preference.sql',
      };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

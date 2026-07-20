/**
 * Brand voice guidelines per entity (Phase 23).
 */

import { randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';

export type BrandVoice = {
  voice_id: string;
  entity_id: string | null;
  name: string;
  tone_guidelines: string | null;
  audience: string | null;
  forbidden_phrases: string[];
  preferred_phrases: string[];
  active: boolean;
  updated_at: string;
};

function mapVoice(row: Record<string, unknown>): BrandVoice {
  const forbidden = row.forbidden_phrases;
  const preferred = row.preferred_phrases;
  return {
    voice_id: String(row.voice_id),
    entity_id: (row.entity_id as string) ?? null,
    name: String(row.name),
    tone_guidelines: (row.tone_guidelines as string) ?? null,
    audience: (row.audience as string) ?? null,
    forbidden_phrases: Array.isArray(forbidden) ? forbidden.map(String) : [],
    preferred_phrases: Array.isArray(preferred) ? preferred.map(String) : [],
    active: Boolean(row.active),
    updated_at: String(row.updated_at),
  };
}

export async function listBrandVoices(): Promise<{
  rows: BrandVoice[];
  error?: string;
}> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_marketing_brand_voices')
      .select('*')
      .eq('active', true)
      .order('updated_at', { ascending: false });
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((r) => mapVoice(r as Record<string, unknown>)),
    };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : 'list failed' };
  }
}

/** Prefer entity-specific voice; fall back to firm-wide (entity_id null). */
export async function resolveBrandVoice(
  entityId?: string | null,
): Promise<BrandVoice | null> {
  const { rows } = await listBrandVoices();
  if (entityId) {
    const match = rows.find((v) => v.entity_id === entityId);
    if (match) return match;
  }
  return rows.find((v) => v.entity_id == null) ?? null;
}

export async function upsertBrandVoice(input: {
  entity_id?: string | null;
  name: string;
  tone_guidelines?: string | null;
  audience?: string | null;
  forbidden_phrases?: string[];
  preferred_phrases?: string[];
}): Promise<{ ok: true; voice: BrandVoice } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const now = new Date().toISOString();
    const entityKey = input.entity_id || null;

    let prior: Record<string, unknown> | null = null;
    if (entityKey) {
      const { data } = await sb
        .from('os_marketing_brand_voices')
        .select('*')
        .eq('active', true)
        .eq('entity_id', entityKey)
        .maybeSingle();
      prior = (data as Record<string, unknown>) ?? null;
    } else {
      const { data } = await sb
        .from('os_marketing_brand_voices')
        .select('*')
        .eq('active', true)
        .is('entity_id', null)
        .maybeSingle();
      prior = (data as Record<string, unknown>) ?? null;
    }

    if (prior) {
      const { data, error } = await sb
        .from('os_marketing_brand_voices')
        .update({
          name: input.name.trim(),
          tone_guidelines: input.tone_guidelines || null,
          audience: input.audience || null,
          forbidden_phrases: input.forbidden_phrases ?? [],
          preferred_phrases: input.preferred_phrases ?? [],
          updated_at: now,
        })
        .eq('voice_id', (prior as { voice_id: string }).voice_id)
        .select('*')
        .single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, voice: mapVoice(data as Record<string, unknown>) };
    }

    const voice_id = `BV-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4)}`;
    const { data, error } = await sb
      .from('os_marketing_brand_voices')
      .insert({
        voice_id,
        entity_id: entityKey,
        name: input.name.trim(),
        tone_guidelines: input.tone_guidelines || null,
        audience: input.audience || null,
        forbidden_phrases: input.forbidden_phrases ?? [],
        preferred_phrases: input.preferred_phrases ?? [],
        active: true,
        updated_at: now,
      })
      .select('*')
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, voice: mapVoice(data as Record<string, unknown>) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'upsert failed' };
  }
}

export function brandVoiceSystemPrompt(voice: BrandVoice | null): string {
  if (!voice) {
    return 'Write clear, professional marketing copy for a venture capital firm and its portfolio companies.';
  }
  const parts = [
    `Brand voice: ${voice.name}.`,
    voice.tone_guidelines ? `Tone: ${voice.tone_guidelines}` : null,
    voice.audience ? `Audience: ${voice.audience}` : null,
    voice.preferred_phrases.length
      ? `Prefer phrases: ${voice.preferred_phrases.join('; ')}`
      : null,
    voice.forbidden_phrases.length
      ? `Never use: ${voice.forbidden_phrases.join('; ')}`
      : null,
  ];
  return parts.filter(Boolean).join('\n');
}

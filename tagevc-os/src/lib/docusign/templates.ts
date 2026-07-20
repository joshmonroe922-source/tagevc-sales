/**
 * DocuSign template cache for hub visibility (Phases 26–28).
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { listDocuSignTemplatesFromApi } from '@/lib/docusign/envelopes';

export type CachedDocuSignTemplate = {
  template_id: string;
  name: string;
  description: string | null;
  shared: boolean;
  last_modified: string | null;
  synced_at: string;
  /** Role names extracted from cached recipients (Phase 28). */
  roles: string[];
};

export function extractTemplateRoles(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as {
    recipients?: {
      signers?: Array<{ roleName?: string; name?: string }>;
      agents?: Array<{ roleName?: string }>;
      carbonCopies?: Array<{ roleName?: string }>;
      editors?: Array<{ roleName?: string }>;
    };
    roles?: Array<{ name?: string; roleName?: string }>;
  };
  const names = new Set<string>();
  const bump = (role?: string | null) => {
    const t = role?.trim();
    if (t) names.add(t);
  };
  for (const s of r.recipients?.signers ?? []) bump(s.roleName);
  for (const s of r.recipients?.agents ?? []) bump(s.roleName);
  for (const s of r.recipients?.carbonCopies ?? []) bump(s.roleName);
  for (const s of r.recipients?.editors ?? []) bump(s.roleName);
  for (const s of r.roles ?? []) bump(s.roleName || s.name);
  return [...names];
}

export async function listCachedTemplates(limit = 40): Promise<{
  rows: CachedDocuSignTemplate[];
  error?: string;
}> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_docusign_templates')
      .select(
        'template_id, name, description, shared, last_modified, synced_at, raw',
      )
      .order('name', { ascending: true })
      .limit(limit);
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => {
        const roles = extractTemplateRoles(row.raw);
        return {
          template_id: String(row.template_id),
          name: String(row.name),
          description: (row.description as string) ?? null,
          shared: Boolean(row.shared),
          last_modified: (row.last_modified as string) ?? null,
          synced_at: String(row.synced_at),
          roles: roles.length > 0 ? roles : ['Signer'],
        };
      }),
    };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : 'list failed',
    };
  }
}

export async function getCachedTemplate(
  templateId: string,
): Promise<CachedDocuSignTemplate | null> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_docusign_templates')
      .select(
        'template_id, name, description, shared, last_modified, synced_at, raw',
      )
      .eq('template_id', templateId)
      .maybeSingle();
    if (error || !data) return null;
    const roles = extractTemplateRoles(data.raw);
    return {
      template_id: String(data.template_id),
      name: String(data.name),
      description: (data.description as string) ?? null,
      shared: Boolean(data.shared),
      last_modified: (data.last_modified as string) ?? null,
      synced_at: String(data.synced_at),
      roles: roles.length > 0 ? roles : ['Signer'],
    };
  } catch {
    return null;
  }
}

export async function syncDocuSignTemplates(): Promise<
  | { ok: true; count: number }
  | { ok: false; error: string }
> {
  const api = await listDocuSignTemplatesFromApi({ count: 50 });
  if (!api.ok) return api;

  try {
    const sb = await createPersistClient();
    const now = new Date().toISOString();
    let count = 0;
    for (const t of api.templates) {
      const { error } = await sb.from('os_docusign_templates').upsert(
        {
          template_id: t.templateId,
          name: t.name,
          description: t.description ?? null,
          shared: Boolean(t.shared),
          last_modified: t.lastModified ?? null,
          raw: t.raw ?? {},
          synced_at: now,
        },
        { onConflict: 'template_id' },
      );
      if (!error) count += 1;
    }
    return { ok: true, count };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'sync failed',
    };
  }
}

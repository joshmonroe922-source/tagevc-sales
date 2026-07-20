/**
 * DocuSign template cache for hub visibility (Phase 26).
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
};

export async function listCachedTemplates(limit = 40): Promise<{
  rows: CachedDocuSignTemplate[];
  error?: string;
}> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_docusign_templates')
      .select(
        'template_id, name, description, shared, last_modified, synced_at',
      )
      .order('name', { ascending: true })
      .limit(limit);
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((r) => ({
        template_id: String(r.template_id),
        name: String(r.name),
        description: (r.description as string) ?? null,
        shared: Boolean(r.shared),
        last_modified: (r.last_modified as string) ?? null,
        synced_at: String(r.synced_at),
      })),
    };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : 'list failed',
    };
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

/**
 * DocuSign template cache for hub visibility (Phases 26–28).
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  getDocuSignTemplateFromApi,
  listDocuSignTemplatesFromApi,
} from '@/lib/docusign/envelopes';

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

export async function listCachedTemplates(opts?: {
  limit?: number;
  offset?: number;
  search?: string;
}): Promise<{
  rows: CachedDocuSignTemplate[];
  count: number;
  error?: string;
}> {
  try {
    const sb = await createPersistClient();
    const limit = Math.min(Math.max(opts?.limit ?? 40, 1), 100);
    const offset = Math.max(opts?.offset ?? 0, 0);
    let query = sb
      .from('os_docusign_templates')
      .select(
        'template_id, name, description, shared, last_modified, synced_at, raw',
        { count: 'exact' },
      )
      .order('name', { ascending: true });
    if (opts?.search?.trim()) {
      const term = opts.search.trim().replace(/[,%()]/g, '').slice(0, 100);
      if (term) {
        query = query.or(
          `name.ilike.%${term}%,description.ilike.%${term}%,template_id.ilike.%${term}%`,
        );
      }
    }
    const { data, error, count } = await query.range(
      offset,
      offset + limit - 1,
    );
    if (error) return { rows: [], count: 0, error: error.message };
    return {
      count: count ?? 0,
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
      count: 0,
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
  | { ok: true; count: number; pages: number; truncated: boolean }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    const now = new Date().toISOString();
    let count = 0;
    let pages = 0;
    let startPosition = 0;
    let truncated = false;
    while (pages < 10 && count < 10_000) {
      const api = await listDocuSignTemplatesFromApi({
        count: 500,
        startPosition,
      });
      if (!api.ok) return api;
      pages += 1;
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
        if (error) {
          return {
            ok: false,
            error: `Template ${t.templateId} upsert failed: ${error.message}`,
          };
        }
        count += 1;
      }
      if (api.pagination.nextStartPosition == null) {
        return { ok: true, count, pages, truncated: false };
      }
      startPosition = api.pagination.nextStartPosition;
    }
    truncated = true;
    return { ok: true, count, pages, truncated };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'sync failed',
    };
  }
}

/** Live refresh of one template's recipients/roles from DocuSign (Phase 29). */
export async function refreshTemplateRecipients(
  templateId: string,
): Promise<
  | { ok: true; template: CachedDocuSignTemplate }
  | { ok: false; error: string }
> {
  const api = await getDocuSignTemplateFromApi(templateId);
  if (!api.ok) return api;

  try {
    const sb = await createPersistClient();
    const now = new Date().toISOString();
    const t = api.template;
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
    if (error) return { ok: false, error: error.message };
    const roles = extractTemplateRoles(t.raw);
    return {
      ok: true,
      template: {
        template_id: t.templateId,
        name: t.name,
        description: t.description ?? null,
        shared: Boolean(t.shared),
        last_modified: t.lastModified ?? null,
        synced_at: now,
        roles: roles.length > 0 ? roles : ['Signer'],
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'refresh failed',
    };
  }
}

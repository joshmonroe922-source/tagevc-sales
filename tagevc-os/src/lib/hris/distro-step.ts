/**
 * HRIS assist for `sd.distro` — add the hire to their entity's distribution group.
 *
 * Previously this step had no handler at all, so it was completed by hand and the
 * only group anyone was added to was the tenant-wide "All Company". A Recruit 619
 * hire needs the Recruit 619 list, not just the whole tenant.
 *
 * Group resolution, in order:
 *   1. Explicit id from `MS_GRAPH_DISTRO_GROUP_IDS` (e.g. "ENT-R619=<guid>,ENT-FIRM=<guid>")
 *   2. Directory lookup by the entity's display name (e.g. "Recruit 619 …")
 *   3. Create one, only when `MS_GRAPH_CREATE_DISTRO_GROUPS` is on
 *
 * `Group.ReadWrite.All` has been held since 2026-08-10, so step 3 is possible. It
 * stays opt-in because it writes a new mail-enabled group into the tenant directory;
 * with the flag off a missing group is still reported as a configuration gap rather
 * than silently passing.
 */

import { entityDisplayName } from '@/lib/entities/display-name';
import { resolveCanonicalEntityId } from '@/lib/multi-sub/entity-registry';
import { getMsGraphToken, graphConfigured } from '@/lib/shared-services/it-mdm';

export const DISTRO_STEP_KEY = 'sd.distro';

export type EntityDistroGroup = {
  id: string;
  displayName: string;
  mail: string | null;
  source: 'env' | 'directory' | 'created';
};

export type DistroAssistResult = {
  handled: boolean;
  detail: string;
  evidence_note?: string;
  /** True when the hire is confirmed in their entity group. */
  joined: boolean;
};

/** Parse "ENT-R619=<guid>,ENT-FIRM=<guid>" into a lookup. */
export function parseDistroGroupEnv(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (raw ?? '').split(',')) {
    const [key, value] = part.split('=');
    const entity = resolveCanonicalEntityId(key?.trim());
    const id = value?.trim();
    if (entity && id) out[entity] = id;
  }
  return out;
}

/** Opt-in: writing a new group into the tenant directory needs an explicit yes. */
export function distroGroupCreateEnabled(): boolean {
  const raw = (process.env.MS_GRAPH_CREATE_DISTRO_GROUPS ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on';
}

/** Entra rejects spaces and most punctuation in `mailNickname`. */
export function distroGroupMailNickname(company: string): string {
  const slug = company
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 54);
  return `${slug || 'entity'}-all`;
}

export function isDistroStep(input: {
  step_key: string;
  system_hook: string | null;
}): boolean {
  return input.step_key === DISTRO_STEP_KEY || input.system_hook === 'distro_add';
}

/** Find the entity's distro group, by configured id then by directory name. */
export async function resolveEntityDistroGroup(
  entityId: string | null | undefined,
  token: string,
): Promise<EntityDistroGroup | null> {
  const canon = resolveCanonicalEntityId(entityId);
  if (!canon) return null;
  const headers = { Authorization: `Bearer ${token}` };

  const configured = parseDistroGroupEnv(process.env.MS_GRAPH_DISTRO_GROUP_IDS)[canon];
  if (configured) {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(configured)}?$select=id,displayName,mail`,
      { headers },
    );
    if (res.ok) {
      const g = (await res.json()) as { id: string; displayName: string; mail: string | null };
      return { id: g.id, displayName: g.displayName, mail: g.mail ?? null, source: 'env' };
    }
    // Configured id is wrong/stale — fall through to a name lookup.
  }

  const company = entityDisplayName(canon, '');
  if (!company) return null;
  const filter = encodeURIComponent(`startswith(displayName,'${company.replace(/'/g, "''")}')`);
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/groups?$filter=${filter}&$select=id,displayName,mail,mailEnabled&$top=20`,
    { headers },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as {
    value?: Array<{ id: string; displayName: string; mail: string | null; mailEnabled: boolean }>;
  };
  const rows = body.value ?? [];
  // Prefer a mail-enabled list; a security group cannot receive company email.
  const hit = rows.find((g) => g.mailEnabled) ?? rows[0];
  if (!hit) return null;
  return {
    id: hit.id,
    displayName: hit.displayName,
    mail: hit.mail ?? null,
    source: 'directory',
  };
}

/**
 * Create the entity's distro group as a Microsoft 365 (Unified) group — the only
 * mail-enabled group type Graph can create. Distribution lists and mail-enabled
 * security groups are Exchange-only.
 */
export async function createEntityDistroGroup(
  entityId: string | null | undefined,
  token: string,
): Promise<{ ok: true; group: EntityDistroGroup } | { ok: false; error: string }> {
  const canon = resolveCanonicalEntityId(entityId);
  const company = canon ? entityDisplayName(canon, '') : '';
  if (!company) return { ok: false, error: `No display name for entity ${entityId ?? 'null'}` };

  const displayName = `${company} All`;
  const res = await fetch('https://graph.microsoft.com/v1.0/groups', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      displayName,
      description: `All ${company} staff — created by Tage OS onboarding`,
      mailNickname: distroGroupMailNickname(company),
      mailEnabled: true,
      securityEnabled: false,
      groupTypes: ['Unified'],
      visibility: 'Private',
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: `Graph create group HTTP ${res.status} ${text.slice(0, 200)}` };
  }
  const g = (await res.json()) as { id: string; displayName: string; mail?: string | null };
  return {
    ok: true,
    group: {
      id: g.id,
      displayName: g.displayName || displayName,
      mail: g.mail ?? null,
      source: 'created',
    },
  };
}

/** Add the hire to their entity distro group. Idempotent, fail-soft. */
export async function runDistroAssist(emp: {
  full_name: string;
  entity_id: string;
  entra_object_id?: string | null;
  work_email?: string | null;
}): Promise<DistroAssistResult> {
  if (!graphConfigured()) {
    return { handled: true, joined: false, detail: 'MS_GRAPH_* not set — distro add unavailable' };
  }
  const tok = await getMsGraphToken();
  if (!tok.ok) return { handled: true, joined: false, detail: tok.detail };

  const company = entityDisplayName(emp.entity_id, emp.entity_id);
  let group = await resolveEntityDistroGroup(emp.entity_id, tok.token);
  if (!group && distroGroupCreateEnabled()) {
    const created = await createEntityDistroGroup(emp.entity_id, tok.token);
    if (!created.ok) {
      const detail = `No distribution group for ${company} and creating one failed: ${created.error}`;
      return { handled: true, joined: false, detail, evidence_note: detail };
    }
    group = created.group;
  }
  if (!group) {
    const detail =
      `No distribution group found for ${company}. ` +
      `Create one (e.g. "${company} All") and set MS_GRAPH_DISTRO_GROUP_IDS, ` +
      `or set MS_GRAPH_CREATE_DISTRO_GROUPS=1 to let Tage create it.`;
    return { handled: true, joined: false, detail, evidence_note: detail };
  }

  const userRef = emp.entra_object_id || emp.work_email;
  if (!userRef) {
    return {
      handled: true,
      joined: false,
      detail: `No Entra object id or work email for ${emp.full_name}`,
    };
  }

  const headers = {
    Authorization: `Bearer ${tok.token}`,
    'Content-Type': 'application/json',
  };

  // Resolve to an object id — the members/$ref endpoint will not take a UPN.
  let objectId = emp.entra_object_id ?? null;
  if (!objectId) {
    const u = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userRef)}?$select=id`,
      { headers },
    );
    if (!u.ok) {
      return {
        handled: true,
        joined: false,
        detail: `Graph user not found for ${userRef}`,
      };
    }
    objectId = ((await u.json()) as { id: string }).id;
  }

  const already = await fetch(
    `https://graph.microsoft.com/v1.0/groups/${group.id}/members/${objectId}/$ref`,
    { headers },
  );
  if (already.ok) {
    const detail = `Already in ${group.displayName}${group.mail ? ` (${group.mail})` : ''}`;
    return { handled: true, joined: true, detail, evidence_note: detail };
  }

  const add = await fetch(`https://graph.microsoft.com/v1.0/groups/${group.id}/members/$ref`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${objectId}`,
    }),
  });
  if (!add.ok) {
    const text = await add.text().catch(() => '');
    const detail = `Could not add to ${group.displayName}: HTTP ${add.status} ${text.slice(0, 160)}`;
    return { handled: true, joined: false, detail, evidence_note: detail };
  }

  const detail =
    `Added to ${group.displayName}${group.mail ? ` (${group.mail})` : ''} for ${company}` +
    (group.source === 'created' ? ' — group created by Tage OS' : '');
  return { handled: true, joined: true, detail, evidence_note: detail };
}

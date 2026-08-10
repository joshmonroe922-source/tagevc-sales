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
 *
 * Creating groups needs `Group.ReadWrite.All`, which the app does not hold, so a
 * missing group is reported as a configuration gap rather than silently passing.
 */

import { entityDisplayName } from '@/lib/entities/display-name';
import { resolveCanonicalEntityId } from '@/lib/multi-sub/entity-registry';
import { getMsGraphToken, graphConfigured } from '@/lib/shared-services/it-mdm';

export const DISTRO_STEP_KEY = 'sd.distro';

export type EntityDistroGroup = {
  id: string;
  displayName: string;
  mail: string | null;
  source: 'env' | 'directory';
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
  const group = await resolveEntityDistroGroup(emp.entity_id, tok.token);
  if (!group) {
    const detail =
      `No distribution group found for ${company}. ` +
      `Create one (e.g. "${company} All") and set MS_GRAPH_DISTRO_GROUP_IDS, ` +
      `or grant Group.ReadWrite.All so Tage can create it.`;
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

  const detail = `Added to ${group.displayName}${group.mail ? ` (${group.mail})` : ''} for ${company}`;
  return { handled: true, joined: true, detail, evidence_note: detail };
}

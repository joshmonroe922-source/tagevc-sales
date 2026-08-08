/**
 * HRIS lifecycle: activate on hire, revoke on term.
 */

import type { HrisEmployee } from '@/lib/hris/types';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { ENTITY_REGISTRY_SEED } from '@/lib/multi-sub/entity-registry';
import {
  activatePersona,
  ensureDigitalCardTemplate,
  revokePersonasForUser,
} from './repo';
import { entityDisplayName } from '@/lib/entities/display-name';

export async function activateDigitalCardForEmployee(
  emp: HrisEmployee,
): Promise<{ ok: boolean; detail: string; public_id?: string }> {
  const profileId = emp.profile_id;
  if (!profileId) {
    return {
      ok: false,
      detail:
        'No linked portal profile yet — link profile_id on the HRIS employee, then re-run Activate digital card.',
    };
  }

  const result = await activatePersona({
    userProfileId: profileId,
    entityId: emp.entity_id,
    displayName: emp.full_name,
    title: emp.role_title || undefined,
    department: emp.department || undefined,
    workEmail: emp.work_email || emp.personal_email || undefined,
    setDefault: true,
  });

  if (!result.ok) {
    return { ok: false, detail: result.error };
  }

  return {
    ok: true,
    detail: result.created
      ? `Activated digital card · ${result.persona.public_id}`
      : `Refreshed digital card · ${result.persona.public_id}`,
    public_id: result.persona.public_id,
  };
}

export async function revokeDigitalCardsForEmployee(
  emp: HrisEmployee,
): Promise<{ ok: boolean; detail: string }> {
  const profileId = emp.profile_id;
  if (!profileId) {
    return {
      ok: true,
      detail: 'No portal profile — nothing to revoke',
    };
  }

  const company = entityDisplayName(emp.entity_id);
  const result = await revokePersonasForUser(
    profileId,
    `No longer with ${company}`,
  );
  if (!result.ok) return { ok: false, detail: result.error };
  return {
    ok: true,
    detail:
      result.count === 0
        ? 'No active personas to revoke'
        : `Revoked ${result.count} digital card persona(s)`,
  };
}

export type ProvisionMissingResult = {
  activated: Array<{
    email: string;
    name: string;
    entity_id: string;
    public_id: string;
    created: boolean;
  }>;
  skipped: Array<{ name: string; email?: string | null; reason: string }>;
  errors: Array<{ name: string; error: string }>;
};

/**
 * Seed `os_digital_card_entity_templates` for every known registry entity
 * (Firm + subsidiaries + any future codes added to ENTITY_REGISTRY_SEED).
 */
export async function seedDigitalCardTemplatesForRegistry(): Promise<{
  seeded: string[];
  errors: Array<{ entity_id: string; error: string }>;
}> {
  const seeded: string[] = [];
  const errors: Array<{ entity_id: string; error: string }> = [];
  for (const row of ENTITY_REGISTRY_SEED) {
    const res = await ensureDigitalCardTemplate(row.entity_code);
    if (!res.ok) {
      errors.push({ entity_id: row.entity_code, error: res.error });
      continue;
    }
    if (res.created) seeded.push(row.entity_code);
  }
  return { seeded, errors };
}

/**
 * Admin: activate a default persona for portal profiles / linked active HRIS
 * employees who are missing one — **all entities**, not Firm/R619 only.
 * Never invents people. Never revokes. Seeds entity templates first.
 */
export async function provisionMissingDigitalCards(): Promise<
  | { ok: true; result: ProvisionMissingResult }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient({ mode: 'service' });
    const activated: ProvisionMissingResult['activated'] = [];
    const skipped: ProvisionMissingResult['skipped'] = [];
    const errors: ProvisionMissingResult['errors'] = [];

    // Ensure brand templates exist for registry entities before activate.
    await seedDigitalCardTemplatesForRegistry();

    const { data: profiles, error: pe } = await sb
      .from('profiles')
      .select('id,email,full_name,entity_id,job_title')
      .not('entity_id', 'is', null);
    if (pe) return { ok: false, error: pe.message };

    const { data: personas } = await sb
      .from('os_digital_card_personas')
      .select('user_profile_id,entity_id,revoked_at,is_active')
      .is('revoked_at', null)
      .eq('is_active', true);

    const covered = new Set(
      (personas || []).map(
        (p) => `${p.user_profile_id}::${p.entity_id}`,
      ),
    );

    for (const p of profiles || []) {
      const entityId = String(p.entity_id || '').trim();
      if (!entityId) {
        skipped.push({
          name: String(p.full_name || p.email || p.id),
          email: p.email,
          reason: 'No entity_id on profile',
        });
        continue;
      }
      const key = `${p.id}::${entityId}`;
      if (covered.has(key)) continue;

      const res = await activatePersona({
        userProfileId: String(p.id),
        entityId,
        displayName: String(p.full_name || p.email || 'Team member'),
        title: p.job_title ? String(p.job_title) : undefined,
        workEmail: p.email ? String(p.email) : undefined,
        setDefault: true,
      });
      if (!res.ok) {
        errors.push({
          name: String(p.full_name || p.email || p.id),
          error: res.error,
        });
        continue;
      }
      covered.add(key);
      activated.push({
        email: String(p.email || ''),
        name: String(p.full_name || p.email || ''),
        entity_id: entityId,
        public_id: res.persona.public_id,
        created: res.created,
      });
    }

    // Active HRIS rows with profile mapping — activate home entity if missing
    const { data: hris } = await sb
      .from('os_hris_employees')
      .select(
        'id,full_name,work_email,entity_id,role_title,department,profile_id,status',
      )
      .eq('status', 'active')
      .not('profile_id', 'is', null);

    for (const emp of hris || []) {
      const profileId = String(emp.profile_id || '');
      const entityId = String(emp.entity_id || '').trim();
      if (!profileId || !entityId) continue;
      const key = `${profileId}::${entityId}`;
      if (covered.has(key)) continue;

      const res = await activatePersona({
        userProfileId: profileId,
        entityId,
        displayName: String(emp.full_name || emp.work_email || 'Team member'),
        title: emp.role_title ? String(emp.role_title) : undefined,
        department: emp.department ? String(emp.department) : undefined,
        workEmail: emp.work_email ? String(emp.work_email) : undefined,
        setDefault: true,
      });

      if (!res.ok) {
        errors.push({
          name: String(emp.full_name || emp.work_email || emp.id),
          error: res.error,
        });
        continue;
      }
      covered.add(key);
      activated.push({
        email: String(emp.work_email || ''),
        name: String(emp.full_name || ''),
        entity_id: entityId,
        public_id: res.persona.public_id,
        created: res.created,
      });
    }

    // Surface active HRIS people blocked on missing portal profile (e.g. Lauren)
    const { data: unlinked } = await sb
      .from('os_hris_employees')
      .select('full_name,work_email,entity_id,status,profile_id')
      .eq('status', 'active')
      .is('profile_id', null);

    for (const emp of unlinked || []) {
      skipped.push({
        name: String(emp.full_name || emp.work_email || 'Employee'),
        email: emp.work_email ? String(emp.work_email) : null,
        reason:
          'Active in HRIS but no portal profile_id — have them sign in once, then re-run provision',
      });
    }

    return { ok: true, result: { activated, skipped, errors } };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Provision failed',
    };
  }
}

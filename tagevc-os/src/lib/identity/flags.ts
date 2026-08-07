/**
 * Identity lifecycle feature flags (sheet 23 §6).
 * Default ON for joiner/leaver; SCIM off until pilot app + NEED_HUMAN licenses.
 * Per-entity cutover: identity.entity.{code}.cutover via IDENTITY_ENTITY_CUTOVER.
 */

function envFlag(name: string, defaultOn: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultOn;
  if (raw === '0' || raw.toLowerCase() === 'false' || raw.toLowerCase() === 'off') {
    return false;
  }
  if (raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'on') {
    return true;
  }
  return defaultOn;
}

export type IdentityFlags = {
  joiner: boolean;
  leaver: boolean;
  mover: boolean;
  scim: boolean;
  byod: boolean;
  remoteHelp: boolean;
  /** When true, Graph mutations also require MS_GRAPH_CREATE_USERS / configure. */
  caCompliantRequired: boolean;
};

export function getIdentityFlags(): IdentityFlags {
  return {
    joiner: envFlag('IDENTITY_JOINER_ENABLED', true),
    leaver: envFlag('IDENTITY_LEAVER_ENABLED', true),
    mover: envFlag('IDENTITY_MOVER_ENABLED', true),
    scim: envFlag('IDENTITY_SCIM_ENABLED', false),
    byod: envFlag('IDENTITY_BYOD_ENABLED', true),
    remoteHelp: envFlag('IDENTITY_REMOTE_HELP_ENABLED', true),
    caCompliantRequired: envFlag('IDENTITY_CA_COMPLIANT_REQUIRED', false),
  };
}

export function assertFlagEnabled(
  flag: keyof IdentityFlags,
): { ok: true } | { ok: false; error: string } {
  const flags = getIdentityFlags();
  if (!flags[flag]) {
    const envKey =
      flag === 'caCompliantRequired'
        ? 'IDENTITY_CA_COMPLIANT_REQUIRED'
        : `IDENTITY_${flag.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase()}_ENABLED`;
    return {
      ok: false,
      error: `identity.${flag} disabled (set ${envKey}=1)`,
    };
  }
  return { ok: true };
}

/**
 * Sheet 23 progressive delivery — `identity.entity.{code}.cutover`.
 *
 * IDENTITY_ENTITY_CUTOVER=ENT-FIRM,ENT-R619
 * Empty / unset = no entity is live-cutover (Graph user create stays dry-run
 * even when MS_GRAPH_* is configured). Explicit `*` enables all entities.
 */
export function getEntityCutoverAllowlist(): string[] | '*' {
  const raw = process.env.IDENTITY_ENTITY_CUTOVER?.trim();
  if (!raw) return [];
  if (raw === '*' || raw.toLowerCase() === 'all') return '*';
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export function isEntityCutoverEnabled(entityId: string): boolean {
  const list = getEntityCutoverAllowlist();
  if (list === '*') return true;
  const id = entityId.trim().toUpperCase();
  return list.includes(id);
}

/**
 * Live Graph user create/disable/enable for this entity.
 * Requires MS_GRAPH_CREATE_USERS=1 (or true) AND entity cutover.
 * Workers still dry-run when Graph app credentials are missing.
 */
export function isGraphUserLiveEnabled(entityId: string): boolean {
  const create =
    process.env.MS_GRAPH_CREATE_USERS === '1' ||
    process.env.MS_GRAPH_CREATE_USERS === 'true';
  if (!create) return false;
  return isEntityCutoverEnabled(entityId);
}

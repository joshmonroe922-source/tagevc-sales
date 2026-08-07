/**
 * Identity lifecycle feature flags (sheet 23 §6).
 * Default ON for joiner/leaver; SCIM off until pilot app + NEED_HUMAN licenses.
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
};

export function getIdentityFlags(): IdentityFlags {
  return {
    joiner: envFlag('IDENTITY_JOINER_ENABLED', true),
    leaver: envFlag('IDENTITY_LEAVER_ENABLED', true),
    mover: envFlag('IDENTITY_MOVER_ENABLED', true),
    scim: envFlag('IDENTITY_SCIM_ENABLED', false),
    byod: envFlag('IDENTITY_BYOD_ENABLED', true),
    remoteHelp: envFlag('IDENTITY_REMOTE_HELP_ENABLED', true),
  };
}

export function assertFlagEnabled(
  flag: keyof IdentityFlags,
): { ok: true } | { ok: false; error: string } {
  const flags = getIdentityFlags();
  if (!flags[flag]) {
    return {
      ok: false,
      error: `identity.${flag} disabled (set IDENTITY_${flag.toUpperCase()}_ENABLED=1)`,
    };
  }
  return { ok: true };
}

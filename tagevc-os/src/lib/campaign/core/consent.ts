import type { ConsentGateResult, EmailPermission } from './types';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Marketing send gate — suppressions + email_permission. Inactive ≠ opted_out. */
export function canSendMarketing(input: {
  email?: string | null;
  emailPermission?: EmailPermission | string | null;
  /** Alias used by dialer/enrollment/orchestrator callers */
  permission?: EmailPermission | string | null;
  suppressed?: boolean;
  killSwitch?: boolean;
  conversing?: boolean;
  topicOptIn?: boolean | null;
  requiresOptIn?: boolean;
}): ConsentGateResult {
  if (input.killSwitch) {
    return { allow: false, reason: 'Entity kill switch active', code: 'KILL_SWITCH' };
  }
  const email = input.email?.trim();
  if (!email || !email.includes('@')) {
    return { allow: false, reason: 'Invalid or missing email', code: 'INVALID_EMAIL' };
  }
  if (input.suppressed) {
    return { allow: false, reason: 'Email on suppression list', code: 'SUPPRESSED' };
  }
  if (input.conversing) {
    return { allow: false, reason: 'Contact in active conversation', code: 'CONVERSING' };
  }
  const perm = (input.emailPermission || input.permission || 'opted_in') as EmailPermission;
  if (perm === 'opted_out') {
    return { allow: false, reason: 'Contact opted out', code: 'OPTED_OUT' };
  }
  if (input.requiresOptIn && input.topicOptIn === false) {
    return { allow: false, reason: 'Topic consent required', code: 'CONSENT_REQUIRED' };
  }
  return { allow: true };
}

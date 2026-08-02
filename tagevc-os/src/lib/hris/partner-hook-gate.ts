/**
 * D07=B — Soft stop when partner hooks are not live.
 * Notify Visionary + HR; allow override with audit note.
 */

export type PartnerHookHealth = {
  hookId: string;
  label: string;
  status: 'live_ok' | 'dry_run' | 'failed' | 'queued';
};

export type SoftStopDecision = {
  canComplete: boolean;
  requiresOverride: boolean;
  notifyRoles: Array<'visionary' | 'hr'>;
  message: string;
};

export function evaluatePartnerHookSoftStop(
  hooks: PartnerHookHealth[],
): SoftStopDecision {
  const blocked = hooks.filter(
    (h) => h.status === 'dry_run' || h.status === 'failed' || h.status === 'queued',
  );
  if (blocked.length === 0) {
    return {
      canComplete: true,
      requiresOverride: false,
      notifyRoles: [],
      message: 'All partner hooks live_ok',
    };
  }
  const names = blocked.map((h) => `${h.label} (${h.status})`).join(', ');
  return {
    canComplete: false,
    requiresOverride: true,
    notifyRoles: ['visionary', 'hr'],
    message: `Automation health: partner hooks not live — ${names}. Notify Visionary + HR, or override with audit note to complete manually while we fix automation.`,
  };
}

export function softStopOverrideAudit(input: {
  actorId: string | null;
  note: string;
  hooks: PartnerHookHealth[];
}): Record<string, unknown> {
  return {
    kind: 'partner_hook_soft_stop_override',
    actor_id: input.actorId,
    note: input.note.trim(),
    hooks: input.hooks,
    at: new Date().toISOString(),
  };
}

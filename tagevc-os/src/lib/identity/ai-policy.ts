/**
 * AI CTO L1–L3 bands + forbid-list (sheet 20).
 * Destructive identity/device actions require human gate.
 */

export type AiBand = 'L1' | 'L2' | 'L3' | 'L4_FORBIDDEN';

export type AiActionRequest = {
  action: string;
  band_requested?: AiBand;
  human_approved?: boolean;
  case_linked?: boolean;
};

const FORBID_LIST = new Set([
  'entra.user.disable',
  'account_disable',
  'intune.device.wipe',
  'wipe',
  'factoryReset',
  'break_glass_checkout',
  'break_glass_use',
  'pim_elevate',
  'role_elevation',
  'global_admin_grant',
  'hard_delete_user',
  'mailbox_purge',
  'unattended_remote_help',
]);

const L2_RUNBOOKS = new Set([
  'retry_worker_job',
  'nudge_byod_sign_in',
  'explain_case_failure',
  'resync_byod_status',
  'requeue_dead_letter_preview',
]);

const L3_GATED = new Set([
  'intune.byod.selective_wipe',
  'intune.byod.retire',
  'entitlement.revoke_all',
  'requeue_dead_letter',
]);

export function isAiForbidListed(action: string): boolean {
  return FORBID_LIST.has(action) || FORBID_LIST.has(action.toLowerCase());
}

export function classifyAiAction(action: string): AiBand {
  if (isAiForbidListed(action)) return 'L4_FORBIDDEN';
  if (L3_GATED.has(action)) return 'L3';
  if (L2_RUNBOOKS.has(action)) return 'L2';
  return 'L1';
}

export function assertAiActionAllowed(req: AiActionRequest): {
  ok: boolean;
  band: AiBand;
  code?: string;
  reason?: string;
} {
  const band = classifyAiAction(req.action);
  if (band === 'L4_FORBIDDEN') {
    return {
      ok: false,
      band,
      code: 'ai_action_blocked',
      reason: `AI CTO forbid-list: ${req.action} requires human operator`,
    };
  }
  if (band === 'L3' && !req.human_approved) {
    return {
      ok: false,
      band,
      code: 'ai_action_blocked',
      reason: `L3 action ${req.action} requires human_approved=true`,
    };
  }
  if (band === 'L2' && req.case_linked === false) {
    return {
      ok: false,
      band,
      code: 'ai_action_blocked',
      reason: 'L2 runbooks require case linkage',
    };
  }
  return { ok: true, band };
}

export function aiForbidList(): string[] {
  return [...FORBID_LIST].sort();
}

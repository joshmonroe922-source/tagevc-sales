/**
 * Live / config gates for in-app AI providers.
 * Claude is fail-closed: never call Anthropic until key + LIVE/enabled flag.
 */

function envTruthy(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function xaiApiKey(): string | null {
  return (
    process.env.XAI_API_KEY?.trim() ||
    process.env.GROK_API_KEY?.trim() ||
    null
  );
}

export function xaiConfigured(): boolean {
  return Boolean(xaiApiKey());
}

export function anthropicApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}

/** Key present (vault / env). Does not enable spend by itself. */
export function claudeConfigured(): boolean {
  return Boolean(anthropicApiKey());
}

/**
 * Spend gate: key + LIVE/enabled flag.
 * Accepts ANTHROPIC_LIVE, CLAUDE_LIVE, or AI_CLAUDE_ENABLED.
 */
export function claudeLiveEnabled(): boolean {
  if (!claudeConfigured()) return false;
  return (
    envTruthy('ANTHROPIC_LIVE') ||
    envTruthy('CLAUDE_LIVE') ||
    envTruthy('AI_CLAUDE_ENABLED')
  );
}

/**
 * Show Claude in settings UI when org has a key or an explicit feature flag
 * (so ops can preview the option before flipping LIVE).
 */
export function claudeSelectableInSettings(orgFeatureEnabled = false): boolean {
  return (
    claudeConfigured() ||
    orgFeatureEnabled ||
    envTruthy('AI_CLAUDE_FEATURE') ||
    envTruthy('CLAUDE_FEATURE')
  );
}

export function orgDefaultProviderFromEnv(): 'grok' | 'claude' | null {
  const raw =
    process.env.AI_ORG_DEFAULT_PROVIDER?.trim().toLowerCase() ||
    process.env.AI_DEFAULT_PROVIDER?.trim().toLowerCase();
  if (raw === 'grok' || raw === 'claude') return raw;
  return null;
}

export const XAI_SETUP_NOTE =
  'Set XAI_API_KEY (or GROK_API_KEY) server-side. Optional: XAI_MODEL (default grok-3-mini), XAI_BASE_URL.';

export const CLAUDE_SETUP_NOTE =
  'Claude is gated. Set ANTHROPIC_API_KEY and ANTHROPIC_LIVE=1 (or CLAUDE_LIVE / AI_CLAUDE_ENABLED). Optional: ANTHROPIC_MODEL.';

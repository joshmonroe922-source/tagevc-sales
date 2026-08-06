import {
  AI_PROVIDER_IDS,
  PLATFORM_DEFAULT_AI_PROVIDER,
  type AiProviderId,
  type AiProviderPreferenceInput,
  type ResolvedAiProvider,
} from '@/lib/ai/types';

export function isAiProviderId(value: unknown): value is AiProviderId {
  return (
    typeof value === 'string' &&
    (AI_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

/**
 * Preference cascade: user override > org default > platform default (Grok).
 * Pure — does not check keys/LIVE flags. Callers gate Claude spend separately.
 */
export function resolveAiProviderPreference(
  input: AiProviderPreferenceInput = {},
): ResolvedAiProvider {
  const platformDefault = isAiProviderId(input.platformDefault)
    ? input.platformDefault
    : PLATFORM_DEFAULT_AI_PROVIDER;

  if (isAiProviderId(input.userPreferred)) {
    return { provider: input.userPreferred, source: 'user' };
  }
  if (isAiProviderId(input.orgDefault)) {
    return { provider: input.orgDefault, source: 'org' };
  }
  return { provider: platformDefault, source: 'platform' };
}

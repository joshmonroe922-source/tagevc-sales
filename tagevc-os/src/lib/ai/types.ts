/** In-app AI providers. Microsoft Copilot / M365 stays external — not a toggle option. */

export const AI_PROVIDER_IDS = ['grok', 'claude'] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const PLATFORM_DEFAULT_AI_PROVIDER: AiProviderId = 'grok';

export type AiProviderPreferenceInput = {
  /** User override; null/undefined = inherit org. */
  userPreferred?: AiProviderId | null;
  /** Org default; null/undefined = inherit platform. */
  orgDefault?: AiProviderId | null;
  /** Platform default when neither user nor org set. */
  platformDefault?: AiProviderId;
};

export type ResolvedAiProvider = {
  provider: AiProviderId;
  source: 'user' | 'org' | 'platform';
};

export type LlmChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LlmChatResult = {
  content: string | null;
  model: string | null;
  provider?: AiProviderId;
  error?: string;
};

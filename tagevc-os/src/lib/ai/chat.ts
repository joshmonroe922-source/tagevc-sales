import { claudeChatCompletion } from '@/lib/ai/claude';
import {
  CLAUDE_SETUP_NOTE,
  claudeLiveEnabled,
  xaiConfigured,
  XAI_SETUP_NOTE,
} from '@/lib/ai/flags';
import { grokChatCompletion } from '@/lib/ai/grok';
import { resolveAiProviderPreference } from '@/lib/ai/resolve';
import type {
  AiProviderId,
  AiProviderPreferenceInput,
  LlmChatMessage,
  LlmChatResult,
} from '@/lib/ai/types';

export type PreferredChatOptions = {
  messages: LlmChatMessage[];
  temperature?: number;
  preference?: AiProviderPreferenceInput;
  /**
   * When preferred provider is Claude but LIVE/key is missing, fall back to Grok
   * (default true) so Think Tank stays usable. Set false for hard fail-closed.
   */
  fallbackToGrok?: boolean;
};

/**
 * Route chat to preferred provider. Claude never spends without key + LIVE.
 */
export async function preferredChatCompletion(
  opts: PreferredChatOptions,
): Promise<LlmChatResult> {
  const resolved = resolveAiProviderPreference(opts.preference ?? {});
  let provider: AiProviderId = resolved.provider;
  const fallbackToGrok = opts.fallbackToGrok !== false;

  if (provider === 'claude' && !claudeLiveEnabled()) {
    if (!fallbackToGrok) {
      return {
        content: null,
        model: null,
        provider: 'claude',
        error: CLAUDE_SETUP_NOTE,
      };
    }
    if (!xaiConfigured()) {
      return {
        content: null,
        model: null,
        provider: 'claude',
        error: `${CLAUDE_SETUP_NOTE} Fallback Grok also unavailable: ${XAI_SETUP_NOTE}`,
      };
    }
    provider = 'grok';
  }

  if (provider === 'claude') {
    return claudeChatCompletion({
      messages: opts.messages,
      temperature: opts.temperature,
    });
  }

  return grokChatCompletion({
    messages: opts.messages,
    temperature: opts.temperature,
  });
}

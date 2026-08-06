/**
 * Think Tank LLM entry — re-exports Grok + shared AI spine helpers.
 * Prefer `@/lib/ai/chat` (`preferredChatCompletion`) for new call sites.
 */
export {
  xaiConfigured,
  XAI_SETUP_NOTE,
  CLAUDE_SETUP_NOTE,
  claudeLiveEnabled,
  claudeConfigured,
} from '@/lib/ai/flags';
export { grokChatCompletion } from '@/lib/ai/grok';
export type { LlmChatResult } from '@/lib/ai/types';

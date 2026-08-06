/**
 * Anthropic Messages API adapter — server-side only.
 * Fail-closed: no network call without ANTHROPIC_API_KEY + LIVE/enabled flag.
 */

import {
  CLAUDE_SETUP_NOTE,
  anthropicApiKey,
  claudeLiveEnabled,
} from '@/lib/ai/flags';
import type { LlmChatMessage, LlmChatResult } from '@/lib/ai/types';

function splitSystem(messages: LlmChatMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  const systemParts: string[] = [];
  const rest: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content);
      continue;
    }
    rest.push({ role: m.role, content: m.content });
  }
  return {
    system: systemParts.length ? systemParts.join('\n\n') : undefined,
    messages: rest,
  };
}

export async function claudeChatCompletion(opts: {
  messages: LlmChatMessage[];
  temperature?: number;
  maxTokens?: number;
}): Promise<LlmChatResult> {
  if (!claudeLiveEnabled()) {
    return {
      content: null,
      model: null,
      provider: 'claude',
      error: CLAUDE_SETUP_NOTE,
    };
  }

  const apiKey = anthropicApiKey();
  if (!apiKey) {
    return {
      content: null,
      model: null,
      provider: 'claude',
      error: CLAUDE_SETUP_NOTE,
    };
  }

  const model =
    process.env.ANTHROPIC_MODEL?.trim() ||
    process.env.CLAUDE_MODEL?.trim() ||
    'claude-3-5-haiku-latest';

  const { system, messages } = splitSystem(opts.messages);
  if (messages.length === 0) {
    return {
      content: null,
      model,
      provider: 'claude',
      error: 'Claude requires at least one user/assistant message',
    };
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature ?? 0.5,
        ...(system ? { system } : {}),
        messages,
      }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        content: null,
        model,
        provider: 'claude',
        error: `Claude HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
      };
    }

    const data = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      model?: string;
    };
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text' || typeof b.text === 'string')
      .map((b) => b.text ?? '')
      .join('')
      .trim();

    if (!text) {
      return {
        content: null,
        model: data.model ?? model,
        provider: 'claude',
        error: 'Empty Claude response',
      };
    }
    return { content: text, model: data.model ?? model, provider: 'claude' };
  } catch (e) {
    return {
      content: null,
      model,
      provider: 'claude',
      error: e instanceof Error ? e.message : 'Claude request failed',
    };
  }
}

/** OpenAI-compatible xAI / Grok chat — server-side only. */

import { XAI_SETUP_NOTE, xaiApiKey } from '@/lib/ai/flags';
import type { LlmChatMessage, LlmChatResult } from '@/lib/ai/types';

export async function grokChatCompletion(opts: {
  messages: LlmChatMessage[];
  temperature?: number;
}): Promise<LlmChatResult> {
  const apiKey = xaiApiKey();
  if (!apiKey) {
    return { content: null, model: null, provider: 'grok', error: XAI_SETUP_NOTE };
  }

  const base =
    process.env.XAI_BASE_URL?.trim()?.replace(/\/$/, '') ||
    'https://api.x.ai/v1';
  const model =
    process.env.XAI_MODEL?.trim() ||
    process.env.GROK_MODEL?.trim() ||
    'grok-3-mini';

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: opts.temperature ?? 0.5,
        messages: opts.messages,
      }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        content: null,
        model,
        provider: 'grok',
        error: `Grok HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
      };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
    };
    const content = data.choices?.[0]?.message?.content?.trim() || null;
    if (!content) {
      return {
        content: null,
        model: data.model ?? model,
        provider: 'grok',
        error: 'Empty Grok response',
      };
    }
    return { content, model: data.model ?? model, provider: 'grok' };
  } catch (e) {
    return {
      content: null,
      model,
      provider: 'grok',
      error: e instanceof Error ? e.message : 'Grok request failed',
    };
  }
}

/** OpenAI-compatible xAI / Grok chat — server-side only. */

export type LlmChatResult = {
  content: string | null;
  model: string | null;
  error?: string;
};

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export function xaiConfigured(): boolean {
  return Boolean(
    process.env.XAI_API_KEY?.trim() || process.env.GROK_API_KEY?.trim(),
  );
}

export const XAI_SETUP_NOTE =
  'Set XAI_API_KEY (or GROK_API_KEY) server-side. Optional: XAI_MODEL (default grok-3-mini), XAI_BASE_URL.';

export async function grokChatCompletion(opts: {
  messages: ChatMessage[];
  temperature?: number;
}): Promise<LlmChatResult> {
  const apiKey =
    process.env.XAI_API_KEY?.trim() || process.env.GROK_API_KEY?.trim();
  if (!apiKey) {
    return { content: null, model: null, error: XAI_SETUP_NOTE };
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
        error: 'Empty Grok response',
      };
    }
    return { content, model: data.model ?? model };
  } catch (e) {
    return {
      content: null,
      model,
      error: e instanceof Error ? e.message : 'Grok request failed',
    };
  }
}

/**
 * AI content generation — stub + OpenAI live provider (Phase 23).
 */

import {
  brandVoiceSystemPrompt,
  resolveBrandVoice,
} from '@/lib/shared-services/marketing-brand';
import type {
  MarketingContentKind,
  MarketingPlatform,
} from './marketing-types';

export type ContentGenerationRequest = {
  kind: MarketingContentKind;
  platform?: MarketingPlatform | null;
  entity_id?: string | null;
  campaign_id?: string | null;
  prompt: string;
  tone?: string;
  max_length?: number;
  /** Pre-resolved brand voice system prompt (optional). */
  brand_system?: string | null;
};

export type ContentGenerationResult = {
  ok: boolean;
  title?: string;
  body?: string;
  meta?: Record<string, unknown>;
  error?: string;
  provider: string;
};

export interface MarketingAiProvider {
  readonly id: string;
  generate(req: ContentGenerationRequest): Promise<ContentGenerationResult>;
}

export class StubMarketingAiProvider implements MarketingAiProvider {
  readonly id = 'stub';

  async generate(
    req: ContentGenerationRequest,
  ): Promise<ContentGenerationResult> {
    const platform = req.platform ?? 'web';
    return {
      ok: true,
      title: `[Draft] ${req.kind} · ${platform}`,
      body: [
        `<!-- AI stub — set MARKETING_AI_PROVIDER=openai + OPENAI_API_KEY for live -->`,
        req.brand_system ? `Brand:\n${req.brand_system}` : null,
        `Prompt: ${req.prompt.slice(0, 500)}`,
        req.tone ? `Tone: ${req.tone}` : null,
        '',
        'Body placeholder for human or AI completion.',
      ]
        .filter(Boolean)
        .join('\n'),
      meta: {
        provider: this.id,
        kind: req.kind,
        platform,
        stub: true,
      },
      provider: this.id,
    };
  }
}

export class OpenAiMarketingAiProvider implements MarketingAiProvider {
  readonly id = 'openai';

  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
  ) {}

  async generate(
    req: ContentGenerationRequest,
  ): Promise<ContentGenerationResult> {
    const platform = req.platform ?? 'web';
    const maxLen = req.max_length ?? (req.kind === 'social' ? 280 : 1200);
    const system = [
      req.brand_system ||
        'Write clear, professional marketing copy for a venture capital firm.',
      `Output JSON only: {"title":"...","body":"..."}.`,
      `Content kind: ${req.kind}. Platform: ${platform}. Max body length ~${maxLen} chars.`,
      req.tone ? `Additional tone: ${req.tone}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.7,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: req.prompt },
          ],
        }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };

      if (!res.ok) {
        return {
          ok: false,
          error: json.error?.message || `OpenAI HTTP ${res.status}`,
          provider: this.id,
        };
      }

      const raw = json.choices?.[0]?.message?.content ?? '{}';
      let parsed: { title?: string; body?: string } = {};
      try {
        parsed = JSON.parse(raw) as { title?: string; body?: string };
      } catch {
        parsed = { title: `Draft ${req.kind}`, body: raw };
      }

      return {
        ok: true,
        title: parsed.title?.trim() || `Draft ${req.kind}`,
        body: parsed.body?.trim() || '',
        meta: {
          provider: this.id,
          model: this.model,
          kind: req.kind,
          platform,
          live: true,
        },
        provider: this.id,
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'OpenAI request failed',
        provider: this.id,
      };
    }
  }
}

function buildProvider(): MarketingAiProvider {
  const id = (process.env.MARKETING_AI_PROVIDER?.trim() || 'stub').toLowerCase();
  if (id === 'openai') {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (key) return new OpenAiMarketingAiProvider(key);
    console.warn(
      '[marketing-ai] MARKETING_AI_PROVIDER=openai but OPENAI_API_KEY missing — using stub',
    );
  }
  return new StubMarketingAiProvider();
}

let activeProvider: MarketingAiProvider | null = null;

export function getMarketingAiProvider(): MarketingAiProvider {
  if (!activeProvider) activeProvider = buildProvider();
  return activeProvider;
}

export function setMarketingAiProvider(provider: MarketingAiProvider) {
  activeProvider = provider;
}

export function getConfiguredAiProviderId(): string {
  const configured = process.env.MARKETING_AI_PROVIDER?.trim() || 'stub';
  if (configured === 'openai' && !process.env.OPENAI_API_KEY?.trim()) {
    return 'stub (openai misconfigured)';
  }
  return getMarketingAiProvider().id;
}

/** Resolve brand voice and generate via active provider. */
export async function generateMarketingContent(
  req: ContentGenerationRequest,
): Promise<ContentGenerationResult> {
  const voice = await resolveBrandVoice(req.entity_id);
  const brand_system = brandVoiceSystemPrompt(voice);
  return getMarketingAiProvider().generate({
    ...req,
    brand_system,
  });
}

/**
 * AI content generation framework stubs (Phase 22).
 * No live LLM calls — providers plug in during Phase 23+.
 */

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

/** Default stub — records intent only; does not call external APIs. */
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
        `<!-- AI stub (Phase 22) — replace with live provider in Phase 23+ -->`,
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

let activeProvider: MarketingAiProvider = new StubMarketingAiProvider();

export function getMarketingAiProvider(): MarketingAiProvider {
  return activeProvider;
}

/** Test / future: swap in OpenAI, Anthropic, etc. */
export function setMarketingAiProvider(provider: MarketingAiProvider) {
  activeProvider = provider;
}

export function getConfiguredAiProviderId(): string {
  return process.env.MARKETING_AI_PROVIDER?.trim() || 'stub';
}

import { TAGEVC_BRAND, type DealPathTopic } from './brand.ts';

export type ContentDraft = {
  blogTitle: string;
  blogBody: string;
  excerpt: string;
  socialCopy: string;
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string[];
  engine: 'openai' | 'template';
};

function templateForTopic(topic: DealPathTopic): ContentDraft {
  const hashtags = TAGEVC_BRAND.hashtags.slice(0, 3).join(' ');

  if (topic === 'launch') {
    return {
      blogTitle: 'Five Signs You Are Ready for a Venture Studio Partnership',
      excerpt:
        'Not every founder needs a studio — but if these five signs resonate, the Launch path may be your fastest route to market.',
      blogBody: `## Introduction

Founders often ask whether they should raise a traditional round, bootstrap, or partner with a venture studio. Neither choice is universal — but patterns emerge.

## Five signs Launch fits

1. **You have domain expertise** — You have seen the problem firsthand.
2. **You want speed** — Six months of operator support beats eighteen months hiring.
3. **You value capital + execution** — Money alone will not ship the product.
4. **You are willing to co-build** — Studio partnerships are active, not passive.
5. **You want GTM from day one** — Website, intake, and outbound wired early.

## What Tage VC does differently

We route Launch leads into a dedicated pipeline with tasks, drips, and content aligned to founder education — not generic VC intake.

## Next step

Submit the Launch path on ${TAGEVC_BRAND.website} and tell us what you are building.`,
      socialCopy: `Five signs you may be ready for a venture studio — not just another seed round. Tage VC's Launch path pairs capital with operators. ${hashtags}`,
      seoTitle: 'Five Signs You Need a Venture Studio | Tage VC',
      seoDescription:
        'How founders know they are ready for venture studio support on the Tage VC Launch path.',
      seoKeywords: ['venture studio', 'launch', 'founder', 'tage vc'],
      engine: 'template',
    };
  }

  if (topic === 'partner') {
    return {
      blogTitle: 'Structuring Strategic Partnerships That Actually Move Revenue',
      excerpt:
        'Growth-stage partnerships fail when economics and integration are vague. Here is how to structure deals that work.',
      blogBody: `## Partnerships are products

Treat every partnership like a product launch: hypothesis, MVP integration, metrics, iterate.

## Three partnership archetypes

- **Channel** — They sell for you or bundle your offer.
- **Product** — Shared roadmap or embedded capability.
- **Capital + strategic** — Investment tied to commercial outcomes.

## Tage VC Partner path

We evaluate Partner inbound for mutual leverage — not logo collection. Expect a 90-day test mindset.

## Contact

Select Partner on our website form with a one-paragraph partnership thesis.`,
      socialCopy: `Partnerships should move revenue in 90 days — not live in slide decks. Tage VC Partner path for growth-stage operators. ${hashtags}`,
      seoTitle: 'Strategic Partnerships That Move Revenue | Tage VC',
      seoDescription:
        'How growth-stage companies structure partnerships with Tage Venture Capital.',
      seoKeywords: ['strategic partnership', 'growth stage', 'tage vc'],
      engine: 'template',
    };
  }

  if (topic === 'exit') {
    return {
      blogTitle: 'Exit Readiness Checklist for Founders (12 Months Out)',
      excerpt:
        'A practical checklist for founders who want optionality — not a fire sale — twelve months before an exit.',
      blogBody: `## Twelve months out

- Clean cap table and option documentation
- Customer contracts assignable on change of control
- Management team retention plan
- Quality of earnings narrative prepared

## Six months out

- Buyer long list segmented (strategic, financial, hybrid)
- Data room skeleton live
- Story tested with advisors

## Tage VC Exit path

Confidential conversations welcome. We do not market your interest.

## Start

Use the Exit path on our contact form.`,
      socialCopy: `Exit readiness starts before you have a buyer. Tage VC helps founders plan transitions with discretion. ${hashtags}`,
      seoTitle: 'Exit Readiness Checklist | Tage VC',
      seoDescription:
        'A 12-month exit readiness checklist for founders working with Tage Venture Capital.',
      seoKeywords: ['business exit', 'founder exit', 'tage vc'],
      engine: 'template',
    };
  }

  return {
    blogTitle: 'Why Operator-Led Venture Firms Win in 2026',
    excerpt:
      'Capital is abundant; execution is scarce. Operator-led firms align with how founders actually build.',
    blogBody: `## Execution is the bottleneck

Founders do not lack ideas or even capital — they lack time and specialized operators.

## Tage VC thesis

We combine venture investing with hands-on support across Launch, Partner, and Exit paths.

## Explore paths

Visit ${TAGEVC_BRAND.website} and choose the path that fits your situation.`,
    socialCopy: `Capital is table stakes. Operators win. Tage Venture Capital — Launch, Partner, Exit. ${hashtags}`,
    seoTitle: 'Operator-Led Venture | Tage VC',
    seoDescription: 'Why operator-led venture firms align with modern founders.',
    seoKeywords: ['venture capital', 'operators', 'tage vc'],
    engine: 'template',
  };
}

async function openAiDraft(topic: DealPathTopic): Promise<ContentDraft | null> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return null;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You write SEO blog and social content for ${TAGEVC_BRAND.name}. Voice: ${TAGEVC_BRAND.voice.join(', ')}. Return JSON: blogTitle, blogBody (markdown), excerpt (160 chars), socialCopy, seoTitle, seoDescription, seoKeywords (array).`,
        },
        {
          role: 'user',
          content: `Write thought leadership for deal path topic: ${topic}. Include CTA to ${TAGEVC_BRAND.website}.`,
        },
      ],
      temperature: 0.7,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return { ...parsed, engine: 'openai' as const };
  } catch {
    return null;
  }
}

export async function generateContentDraft(
  topic: DealPathTopic = 'general',
): Promise<ContentDraft> {
  return (await openAiDraft(topic)) ?? templateForTopic(topic);
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

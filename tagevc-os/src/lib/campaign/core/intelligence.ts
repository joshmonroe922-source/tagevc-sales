/**
 * Phase 7 — Engagement intelligence.
 * STO, RFM, AI assist drafts (never auto-send), attribution lite, coaching win-rates.
 */

export type HourHistogram = number[]; // length 24, counts per local hour

/** Preferred send hour from historical opens/clicks (STO). */
export function preferredSendHour(
  hours: HourHistogram,
  fallback = 10,
): { hour: number; confidence: number; samples: number } {
  const hist =
    hours.length === 24 ? hours.map((n) => Math.max(0, Number(n) || 0)) : Array(24).fill(0);
  const samples = hist.reduce((a, b) => a + b, 0);
  if (samples === 0) {
    return { hour: fallback, confidence: 0, samples: 0 };
  }
  let best = 0;
  for (let h = 1; h < 24; h++) {
    if (hist[h]! > hist[best]!) best = h;
  }
  const confidence = Math.min(1, hist[best]! / samples + Math.min(0.3, samples / 40));
  return { hour: best, confidence: Math.round(confidence * 100) / 100, samples };
}

/** Fan-out schedule: map contacts to preferred local hour buckets. */
export function stoFanout(
  contacts: Array<{ contactId: string; preferredHour: number | null }>,
  fallbackHour = 10,
): Map<number, string[]> {
  const buckets = new Map<number, string[]>();
  for (const c of contacts) {
    const h =
      c.preferredHour != null && c.preferredHour >= 0 && c.preferredHour <= 23
        ? c.preferredHour
        : fallbackHour;
    const list = buckets.get(h) || [];
    list.push(c.contactId);
    buckets.set(h, list);
  }
  return buckets;
}

export type RfmInput = {
  daysSinceLastEngage: number | null;
  engageCount30d: number;
  conversionValue?: number; // optional "monetary" proxy (e.g. signed deals)
};

/** RFM-style 1–5 scores + composite 0–100. */
export function computeRfm(input: RfmInput): {
  r: number;
  f: number;
  m: number;
  score: number;
  segment: 'champions' | 'loyal' | 'at_risk' | 'hibernating' | 'new';
} {
  const days = input.daysSinceLastEngage;
  let r = 1;
  if (days == null) r = 1;
  else if (days <= 3) r = 5;
  else if (days <= 7) r = 4;
  else if (days <= 14) r = 3;
  else if (days <= 30) r = 2;

  const fCount = input.engageCount30d;
  let f = 1;
  if (fCount >= 10) f = 5;
  else if (fCount >= 5) f = 4;
  else if (fCount >= 3) f = 3;
  else if (fCount >= 1) f = 2;

  const mVal = input.conversionValue ?? 0;
  let m = 1;
  if (mVal >= 8) m = 5;
  else if (mVal >= 5) m = 4;
  else if (mVal >= 2) m = 3;
  else if (mVal >= 1) m = 2;

  const score = Math.round(((r + f + m) / 15) * 100);
  let segment: 'champions' | 'loyal' | 'at_risk' | 'hibernating' | 'new' = 'new';
  if (r >= 4 && f >= 4) segment = 'champions';
  else if (r >= 3 && f >= 3) segment = 'loyal';
  else if (r <= 2 && f >= 3) segment = 'at_risk';
  else if (r <= 2 && f <= 2) segment = 'hibernating';
  else if (r >= 4 && f <= 2) segment = 'new';

  return { r, f, m, score, segment };
}

export type AiAssistTone = 'professional' | 'warm' | 'direct' | 'executive';

export type AiAssistDraft = {
  subject: string;
  body_html: string;
  score: number;
  rationale: string;
  auto_send: false;
  requires_human_approval: true;
};

/**
 * Deterministic AI-assist rewrite (no model call required for tests / offline).
 * NEVER marks auto_send — human must approve (N13).
 */
export function draftAiAssist(input: {
  subject: string;
  body_html: string;
  tone?: AiAssistTone;
  brandVoice?: string;
}): AiAssistDraft {
  const tone = input.tone || 'professional';
  const subjectBase = (input.subject || 'Quick note').trim();
  const tonePrefix: Record<AiAssistTone, string> = {
    professional: '',
    warm: 'Hope you\'re well — ',
    direct: '',
    executive: 'Brief: ',
  };
  let subject = `${tonePrefix[tone]}${subjectBase}`.trim();
  if (tone === 'direct' && !subject.endsWith('?') && subject.length < 60) {
    subject = subject.replace(/\.$/, '');
  }
  if (subject.length > 78) subject = subject.slice(0, 75) + '…';

  const opener: Record<AiAssistTone, string> = {
    professional: '<p>I wanted to follow up with a clear next step.</p>',
    warm: '<p>Hope this finds you well — sharing a quick update.</p>',
    direct: '<p>Sharing the key point up front:</p>',
    executive: '<p><strong>Bottom line:</strong></p>',
  };

  const body = input.body_html?.trim() || '<p></p>';
  const alreadyHasOpener = /hope|follow up|bottom line/i.test(body);
  const body_html = alreadyHasOpener
    ? body
    : `${opener[tone]}${body}${
        input.brandVoice
          ? `<p style="color:#7c7871;font-size:12px">Voice: ${escape(input.brandVoice)}</p>`
          : ''
      }`;

  const score = scoreCopyQuality(subject, body_html);
  return {
    subject,
    body_html,
    score,
    rationale: `Tone=${tone}; length-checked; human approval required before send.`,
    auto_send: false,
    requires_human_approval: true,
  };
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function scoreCopyQuality(subject: string, bodyHtml: string): number {
  let score = 50;
  const subLen = subject.length;
  if (subLen >= 20 && subLen <= 55) score += 15;
  else if (subLen > 0 && subLen < 80) score += 5;
  if (!/[!]{2,}|FREE|ACT NOW|$$$/i.test(subject)) score += 10;
  else score -= 20;
  const text = bodyHtml.replace(/<[^>]+>/g, ' ');
  if (text.length > 80 && text.length < 1200) score += 15;
  if (/\{\{/.test(bodyHtml)) score += 5; // personalization present
  if (!/<a\s/i.test(bodyHtml) && text.length > 200) score -= 5;
  return Math.max(0, Math.min(100, score));
}

export type AttributionEvent = {
  type: 'click' | 'call' | 'sign' | 'reply';
  at: string;
  contactId: string;
  campaignId?: string | null;
};

/** Lite attribution: click → call → sign chain within windows. */
export function attributionLite(
  events: AttributionEvent[],
  opts?: { clickToCallHours?: number; callToSignDays?: number },
): {
  clickToCall: number;
  callToSign: number;
  clickToSign: number;
  paths: Array<{ contactId: string; campaignId?: string | null; path: string }>;
} {
  const clickToCallH = opts?.clickToCallHours ?? 72;
  const callToSignD = opts?.callToSignDays ?? 14;
  const byContact = new Map<string, AttributionEvent[]>();
  for (const e of events) {
    const list = byContact.get(e.contactId) || [];
    list.push(e);
    byContact.set(e.contactId, list);
  }

  let clickToCall = 0;
  let callToSign = 0;
  let clickToSign = 0;
  const paths: Array<{ contactId: string; campaignId?: string | null; path: string }> = [];

  for (const [contactId, list] of byContact) {
    const sorted = [...list].sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
    );
    const clicks = sorted.filter((e) => e.type === 'click');
    const calls = sorted.filter((e) => e.type === 'call');
    const signs = sorted.filter((e) => e.type === 'sign');

    for (const click of clicks) {
      const call = calls.find(
        (c) =>
          new Date(c.at).getTime() - new Date(click.at).getTime() >= 0 &&
          new Date(c.at).getTime() - new Date(click.at).getTime() <=
            clickToCallH * 3600_000,
      );
      if (call) {
        clickToCall += 1;
        paths.push({
          contactId,
          campaignId: click.campaignId,
          path: 'click→call',
        });
        const sign = signs.find(
          (s) =>
            new Date(s.at).getTime() - new Date(call.at).getTime() >= 0 &&
            new Date(s.at).getTime() - new Date(call.at).getTime() <=
              callToSignD * 86400_000,
        );
        if (sign) {
          callToSign += 1;
          clickToSign += 1;
          paths.push({
            contactId,
            campaignId: click.campaignId,
            path: 'click→call→sign',
          });
        }
      } else {
        const sign = signs.find(
          (s) =>
            new Date(s.at).getTime() - new Date(click.at).getTime() >= 0 &&
            new Date(s.at).getTime() - new Date(click.at).getTime() <=
              callToSignD * 86400_000,
        );
        if (sign) {
          clickToSign += 1;
          paths.push({
            contactId,
            campaignId: click.campaignId,
            path: 'click→sign',
          });
        }
      }
    }
  }

  return { clickToCall, callToSign, clickToSign, paths };
}

export type TemplateWinRow = {
  templateId: string;
  templateName: string;
  sends: number;
  opens: number;
  clicks: number;
  replies: number;
};

export function templateWinRates(rows: TemplateWinRow[]): Array<
  TemplateWinRow & {
    openRate: number;
    clickRate: number;
    replyRate: number;
    winScore: number;
  }
> {
  return rows
    .map((r) => {
      const openRate = r.sends ? r.opens / r.sends : 0;
      const clickRate = r.sends ? r.clicks / r.sends : 0;
      const replyRate = r.sends ? r.replies / r.sends : 0;
      const winScore = Math.round(
        (openRate * 0.2 + clickRate * 0.45 + replyRate * 0.35) * 1000,
      ) / 10;
      return { ...r, openRate, clickRate, replyRate, winScore };
    })
    .sort((a, b) => b.winScore - a.winScore);
}

export type NextBestStep =
  | { action: 'call'; reason: string }
  | { action: 'email'; reason: string }
  | { action: 'enroll'; reason: string; journeyHint?: string }
  | { action: 'wait'; reason: string }
  | { action: 'pause'; reason: string };

/** Cadence intelligence hint — advisory only. */
export function nextBestStep(input: {
  engagementScore: number;
  replied?: boolean;
  conversing?: boolean;
  clickedNoReply?: boolean;
  daysSinceActivity?: number | null;
  enrolled?: boolean;
}): NextBestStep {
  if (input.conversing || input.replied) {
    return { action: 'pause', reason: 'Conversation detected — pause cadences' };
  }
  if (input.clickedNoReply || input.engagementScore >= 4) {
    return { action: 'call', reason: 'Hot engagement — prioritize phone follow-up' };
  }
  if ((input.daysSinceActivity ?? 99) > 14 && !input.enrolled) {
    return {
      action: 'enroll',
      reason: 'Cold contact — enroll in nurture sequence',
      journeyHint: 'multichannel_outreach',
    };
  }
  if ((input.daysSinceActivity ?? 0) < 1) {
    return { action: 'wait', reason: 'Recent touch — respect quiet window' };
  }
  return { action: 'email', reason: 'Standard follow-up email' };
}

/** Documented lift experiment framework (Phase 7 DoD). */
export const LIFT_EXPERIMENT_FRAMEWORK = {
  name: 'ECC lift experiments',
  principles: [
    'Holdout ≥10% when measuring STO or subject AI assist',
    'Primary metric: reply rate (secondary: click, DocuSign complete)',
    'Min sample: 200 delivered per arm before calling winner',
    'AI / STO never auto-apply to full send without human approve',
  ],
  arms: ['control', 'sto_preferred_hour', 'ai_subject_approved'],
} as const;

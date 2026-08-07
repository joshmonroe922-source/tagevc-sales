/**
 * Entity-aware routing suggestions. Conservative: human confirm for create.
 */

import type { RoutingSuggestion } from './types';

export function suggestRouting(input: {
  entityId: string;
  intent?: string | null;
  note?: string | null;
  howWeMet?: string | null;
  company?: string | null;
}): RoutingSuggestion {
  const blob = [
    input.intent,
    input.note,
    input.howWeMet,
    input.company,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const hiring =
    input.intent === 'hiring' ||
    /\b(hire|hiring|need talent|staff(ing)?|recruiter|fill (a |the )?role)\b/.test(
      blob,
    );
  const jobseek =
    input.intent === 'jobseek' ||
    /\b(looking for (a )?job|job seek|open to work|resume|résumé|candidate)\b/.test(
      blob,
    );

  if (input.entityId === 'ENT-R619') {
    if (hiring) {
      return {
        action: 'client_lead',
        confidence: input.intent === 'hiring' ? 'high' : 'medium',
        reason: 'Recruit 619 · hiring / need talent signal',
        human_confirm: true,
      };
    }
    if (jobseek) {
      return {
        action: 'candidate_interest',
        confidence: input.intent === 'jobseek' ? 'high' : 'medium',
        reason: 'Recruit 619 · job-seek / general interest signal',
        human_confirm: true,
      };
    }
    return {
      action: 'network_contact',
      confidence: 'low',
      reason: 'Recruit 619 · keep as network contact until intent is clear',
      human_confirm: true,
    };
  }

  if (input.entityId === 'ENT-SIGNENT') {
    return {
      action: 'sales_notify',
      confidence: 'medium',
      reason: 'Signent HR · network contact + sales notify',
      human_confirm: false,
    };
  }

  if (input.entityId === 'ENT-INDA') {
    return {
      action: 'network_contact',
      confidence: 'medium',
      reason: 'Instant NDA · network contact + product CTA attribution',
      human_confirm: false,
    };
  }

  return {
    action: 'network_contact',
    confidence: 'medium',
    reason: 'Tage VC · parent network contact',
    human_confirm: false,
  };
}

/** Explainable dedupe suggestions — never silent destructive merge. */
export type DedupeSuggestion = {
  kind: 'network_contact' | 'client_lead' | 'candidate';
  match_on: 'email' | 'phone';
  match_value: string;
  existing_id: string;
  confidence: 'medium' | 'high';
  message: string;
};

export function buildDedupeSuggestions(input: {
  email?: string | null;
  phone?: string | null;
  existingContacts: Array<{ id: string; email?: string | null; phone?: string | null }>;
}): DedupeSuggestion[] {
  const out: DedupeSuggestion[] = [];
  const email = input.email?.trim().toLowerCase();
  const phone = input.phone?.replace(/\D/g, '');

  for (const c of input.existingContacts) {
    if (email && c.email?.trim().toLowerCase() === email) {
      out.push({
        kind: 'network_contact',
        match_on: 'email',
        match_value: email,
        existing_id: c.id,
        confidence: 'high',
        message: `Same email as existing network contact ${c.id.slice(0, 8)}… — suggest link; human confirms merge`,
      });
    }
    const cPhone = c.phone?.replace(/\D/g, '');
    if (phone && phone.length >= 7 && cPhone === phone) {
      out.push({
        kind: 'network_contact',
        match_on: 'phone',
        match_value: phone,
        existing_id: c.id,
        confidence: 'medium',
        message: `Same phone as existing network contact ${c.id.slice(0, 8)}… — suggest link; human confirms merge`,
      });
    }
  }
  return out;
}

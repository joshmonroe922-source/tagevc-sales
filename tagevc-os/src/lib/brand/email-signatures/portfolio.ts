/**
 * Portfolio logo-bar matrix for email signatures.
 *
 * Parent (ENT-FIRM): Tage + all subsidiaries.
 * Subsidiary: primary entity + parent + sisters (future-proof — driven by registry).
 */

import { ENTITY_SELECT_PRIORITY_IDS } from '@/lib/entities/display-order';
import { entityDisplayName, normalizeEntityId } from '@/lib/entities/display-name';
import { getEntityLogo } from '@/lib/entities/logo';
import { getEntityBrandPresence } from '@/lib/shared-services/entity-brand-presence';

export const PARENT_ENTITY_ID = 'ENT-FIRM';

/** Ordered portfolio entities (parent first, then subsidiaries). */
export function portfolioEntityIds(): string[] {
  return [...ENTITY_SELECT_PRIORITY_IDS];
}

export function subsidiaryEntityIds(): string[] {
  return portfolioEntityIds().filter((id) => id !== PARENT_ENTITY_ID);
}

export type SignatureLogoLink = {
  entityId: string;
  label: string;
  href: string;
  logoUrl: string;
  /** True when this row is the signer's primary employer mark */
  primary: boolean;
  /** Document if using a placeholder / provisional URL */
  urlNote?: string;
};

/**
 * Logo bar for an employee's entity.
 * Always includes parent + every known subsidiary so new entities appear
 * automatically when added to ENTITY_SELECT_PRIORITY_IDS + logo catalog.
 */
export function signatureLogoBar(
  signerEntityId: string | null | undefined,
): SignatureLogoLink[] {
  const primaryId = normalizeEntityId(signerEntityId) || PARENT_ENTITY_ID;
  const order = orderedLogoBarIds(primaryId);
  return order.map((id) => {
    const logo = getEntityLogo(id, 'primary', { surface: 'light' });
    const presence = getEntityBrandPresence(id);
    const href = (presence?.website_url || '').trim() || placeholderSite(id);
    const urlNote = presence?.website_url?.trim()
      ? undefined
      : `PLACEHOLDER site for ${entityDisplayName(id)} — confirm marketing URL`;
    return {
      entityId: id,
      label: entityDisplayName(id),
      href,
      logoUrl: logo?.publicUrl ?? '',
      primary: id === primaryId,
      urlNote,
    };
  });
}

/** Primary entity first, then parent (if different), then remaining sisters in priority order. */
export function orderedLogoBarIds(primaryEntityId: string): string[] {
  const primary = normalizeEntityId(primaryEntityId) || PARENT_ENTITY_ID;
  const all = portfolioEntityIds();
  const rest = all.filter((id) => id !== primary);
  if (primary === PARENT_ENTITY_ID) {
    return [PARENT_ENTITY_ID, ...rest];
  }
  const parentFirst = [
    primary,
    PARENT_ENTITY_ID,
    ...rest.filter((id) => id !== PARENT_ENTITY_ID),
  ];
  // de-dupe while preserving order
  const seen = new Set<string>();
  return parentFirst.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function placeholderSite(entityId: string): string {
  const hints: Record<string, string> = {
    'ENT-FIRM': 'https://tagevc.com',
    'ENT-R619': 'https://recruit619.com',
    'ENT-SIGNENT': 'https://signenthr.com',
    'ENT-INDA': 'https://instantnda.us',
  };
  return hints[entityId] ?? `https://example.com/${entityId.toLowerCase()}`;
}

export function missingWebsiteNotes(
  signerEntityId: string | null | undefined,
): string[] {
  return signatureLogoBar(signerEntityId)
    .filter((l) => l.urlNote)
    .map((l) => l.urlNote!) ;
}

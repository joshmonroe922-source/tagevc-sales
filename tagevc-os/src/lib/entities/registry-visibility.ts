/**
 * Firm-page / portfolio registry visibility.
 *
 * Sample and legacy-duplicate companies are hidden from the operating views
 * (Firm "Active companies" + "Registry companies", Command Center, Dashboard,
 * Entities list). This is a durable filter keyed on stable entity ids (with a
 * name-pattern fallback) so the rows do not reappear on reload even when the
 * underlying data is served from SQL rather than the seed.
 *
 * Real operating subsidiaries kept: ENT-FIRM, ENT-R619, ENT-INDA, ENT-SIGNENT.
 * The IES entity map (os_ies_entity_map) is a separate table and is NOT
 * affected by these filters — the SSC / IES entity dropdown keeps all four
 * real entities.
 */

import { normalizeEntityId } from '@/lib/entities/display-name';

/**
 * Entities hidden from the Registry ("Parent and subsidiaries") list.
 * Includes the sample companies AND the legacy Instant NDA alias (ENT-002),
 * whose canonical record is ENT-INDA.
 */
export const HIDDEN_REGISTRY_ENTITY_IDS: ReadonlySet<string> = new Set([
  'ENT-001', // Sample Closed Co
  'ENT-002', // Instant NDA (Legacy alias) — canonical is ENT-INDA
  'ENT-003', // Sample Indy SFR
  'ENT-RE-001', // Sample Indy SFR (seed RE asset entity id)
]);

/**
 * Entities hidden from the "Active companies" portfolio list.
 * Samples only — the current Instant NDA row is always kept regardless of
 * whether its portfolio record is keyed on ENT-INDA or the legacy ENT-002.
 */
export const HIDDEN_ACTIVE_ENTITY_IDS: ReadonlySet<string> = new Set([
  'ENT-001', // Sample Closed Co
  'ENT-003', // Sample Indy SFR
  'ENT-RE-001', // Sample Indy SFR (seed RE asset entity id)
]);

function nameMatchesSample(name: string | null | undefined): boolean {
  const n = (name ?? '').toLowerCase();
  return n.includes('sample closed') || n.includes('sample indy');
}

function nameMatchesLegacy(name: string | null | undefined): boolean {
  const n = (name ?? '').toLowerCase();
  return n.includes('(legacy');
}

/** True when a company row should NOT appear in the Active companies list. */
export function isHiddenActiveCompany(input: {
  entity_id?: string | null;
  company_name?: string | null;
  canonical_name?: string | null;
}): boolean {
  const id = normalizeRaw(input.entity_id);
  if (id && HIDDEN_ACTIVE_ENTITY_IDS.has(id)) return true;
  return (
    nameMatchesSample(input.company_name) ||
    nameMatchesSample(input.canonical_name)
  );
}

/** True when an entity should NOT appear in the Registry companies list. */
export function isHiddenRegistryEntity(input: {
  entity_id?: string | null;
  canonical_name?: string | null;
}): boolean {
  const id = normalizeRaw(input.entity_id);
  if (id && HIDDEN_REGISTRY_ENTITY_IDS.has(id)) return true;
  return (
    nameMatchesSample(input.canonical_name) ||
    nameMatchesLegacy(input.canonical_name)
  );
}

/**
 * Keep the raw id AND its normalized form comparable — ENT-002 must still match
 * even though normalizeEntityId collapses it to ENT-INDA for display.
 */
function normalizeRaw(entityId: string | null | undefined): string {
  const raw = (entityId ?? '').trim();
  if (!raw) return '';
  // Do NOT collapse legacy alias here — we want ENT-002 to match its own id.
  return raw === 'ENT-002' ? 'ENT-002' : normalizeEntityId(raw);
}

export type CompanySelectOption = {
  entity_id: string;
  name: string;
};

/**
 * Build company-filter options for Dashboard / scope dropdowns.
 * Hides registry-hidden rows (legacy Instant NDA ENT-002, samples), collapses
 * aliases to the canonical id (ENT-002 → ENT-INDA), and dedupes by entity_id
 * so Instant NDA appears once as ENT-INDA (IES `9341457533727282`).
 */
export function toVisibleCompanySelectOptions(
  companies: ReadonlyArray<{
    entity_id?: string | null;
    company_name?: string | null;
    name?: string | null;
    canonical_name?: string | null;
  }>,
): CompanySelectOption[] {
  const seen = new Set<string>();
  const out: CompanySelectOption[] = [];

  for (const c of companies) {
    const rawId = (c.entity_id ?? '').trim();
    if (!rawId) continue;
    const label =
      (c.name ?? '').trim() ||
      (c.company_name ?? '').trim() ||
      (c.canonical_name ?? '').trim() ||
      rawId;
    if (
      isHiddenRegistryEntity({
        entity_id: rawId,
        canonical_name: label,
      })
    ) {
      continue;
    }
    const entity_id = normalizeEntityId(rawId);
    if (!entity_id || seen.has(entity_id)) continue;
    seen.add(entity_id);
    // Prefer canonical labels so ENT-INDA is always "Instant NDA".
    const known: Record<string, string> = {
      'ENT-FIRM': 'Tage Venture Capital',
      'ENT-R619': 'Recruit 619',
      'ENT-SIGNENT': 'Signent HR',
      'ENT-INDA': 'Instant NDA',
    };
    out.push({
      entity_id,
      name: known[entity_id] ?? label,
    });
  }

  return out;
}

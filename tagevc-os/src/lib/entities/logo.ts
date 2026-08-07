/**
 * Entity logo Source of Truth resolver.
 * Files live in Marketing / Brand (doc library) and
 * brand-assets/marketing-sot/{entity_id}/ — do not re-upload from here.
 */

import { entityDisplayName, normalizeEntityId } from '@/lib/entities/display-name';

export type EntityLogoRole = 'primary' | 'icon';
export type EntityLogoSurface = 'light' | 'dark';

export type EntityLogoVariantKey =
  | 'gold-blue-on-white'
  | 'gold-white-on-navy'
  | 'gold-on-white'
  | 'blue-on-white'
  | 'gold-on-navy'
  | 'navy-on-white'
  | 'horizontal'
  | 'horizontal-outlined'
  | 'badge';

export type EntityLogoAsset = {
  variant: EntityLogoVariantKey;
  docId: string;
  filename: string;
};

export type EntityLogoResolved = {
  entityId: string;
  role: EntityLogoRole;
  surface: EntityLogoSurface;
  variant: EntityLogoVariantKey;
  docId: string;
  filename: string;
  /** Public Supabase storage URL */
  publicUrl: string;
  /** App-local path under /public/brand */
  localPublicPath: string;
  alt: string;
};

const PUBLIC_BASE =
  'https://opdqybaatfbwkokbzwli.supabase.co/storage/v1/object/public/brand-assets/marketing-sot';

/** Canonical logo families — must match brand/marketing-sot/MANIFEST.md */
export const ENTITY_LOGO_CATALOG: Record<string, EntityLogoAsset[]> = {
  'ENT-FIRM': [
    {
      variant: 'gold-blue-on-white',
      docId: 'DOC-BRAND-FIRM-GOLD-BLUE-ON-WHITE',
      filename: 'tagevc-logo-gold-blue-on-white-rectangle.png',
    },
    {
      variant: 'gold-white-on-navy',
      docId: 'DOC-BRAND-FIRM-GOLD-WHITE-ON-NAVY',
      filename: 'tagevc-logo-gold-white-on-navy-rectangle.png',
    },
  ],
  'ENT-R619': [
    {
      variant: 'gold-on-white',
      docId: 'DOC-BRAND-R619-GOLD-ON-WHITE',
      filename: 'recruit619-logo-gold-on-white-rectangle.png',
    },
    {
      variant: 'blue-on-white',
      docId: 'DOC-BRAND-R619-BLUE-ON-WHITE',
      filename: 'recruit619-logo-blue-on-white-rectangle.png',
    },
    {
      variant: 'gold-on-navy',
      docId: 'DOC-BRAND-R619-GOLD-ON-NAVY',
      filename: 'recruit619-logo-gold-on-navy-rectangle.png',
    },
  ],
  'ENT-INDA': [
    {
      variant: 'horizontal',
      docId: 'DOC-BRAND-INDA-HORIZONTAL',
      filename: 'instantnda-logo-horizontal.png',
    },
    {
      variant: 'horizontal-outlined',
      docId: 'DOC-BRAND-INDA-HORIZONTAL-OUTLINED',
      filename: 'instantnda-logo-horizontal-outlined.png',
    },
    {
      variant: 'badge',
      docId: 'DOC-BRAND-INDA-BADGE',
      filename: 'instantnda-badge.png',
    },
  ],
  'ENT-SIGNENT': [
    {
      variant: 'gold-on-white',
      docId: 'DOC-BRAND-SIGNENT-GOLD-ON-WHITE',
      filename: 'signent-hr-logo-gold-on-white-rectangle.png',
    },
    {
      variant: 'navy-on-white',
      docId: 'DOC-BRAND-SIGNENT-NAVY-ON-WHITE',
      filename: 'signent-hr-logo-navy-on-white-rectangle.png',
    },
    {
      variant: 'gold-on-navy',
      docId: 'DOC-BRAND-SIGNENT-GOLD-ON-NAVY',
      filename: 'signent-hr-logo-gold-on-navy-rectangle.png',
    },
  ],
};

const BRAND_ENTITY_IDS = ['ENT-FIRM', 'ENT-R619', 'ENT-SIGNENT', 'ENT-INDA'] as const;

/** Signent family colors from Marketing SoT */
export const SIGNENT_FAMILY_COLORS = {
  gold: '#B2A384',
  navy: '#3B4559',
  white: '#FFFFFF',
} as const;

function pickVariant(
  entityId: string,
  role: EntityLogoRole,
  surface: EntityLogoSurface,
): EntityLogoVariantKey | null {
  const catalog = ENTITY_LOGO_CATALOG[entityId];
  if (!catalog?.length) return null;
  const has = (v: EntityLogoVariantKey) => catalog.some((a) => a.variant === v);

  if (entityId === 'ENT-INDA') {
    if (role === 'icon' && has('badge')) return 'badge';
    if (surface === 'dark' && has('horizontal-outlined')) return 'horizontal-outlined';
    return 'horizontal';
  }

  if (surface === 'dark') {
    if (has('gold-white-on-navy')) return 'gold-white-on-navy';
    if (has('gold-on-navy')) return 'gold-on-navy';
  }

  if (role === 'icon') {
    if (has('badge')) return 'badge';
    if (has('navy-on-white')) return 'navy-on-white';
    if (has('blue-on-white')) return 'blue-on-white';
  }

  if (has('gold-blue-on-white')) return 'gold-blue-on-white';
  if (has('gold-on-white')) return 'gold-on-white';
  if (has('horizontal')) return 'horizontal';
  return catalog[0]?.variant ?? null;
}

export function getEntityLogo(
  entityId: string | null | undefined,
  role: EntityLogoRole = 'primary',
  opts?: { surface?: EntityLogoSurface },
): EntityLogoResolved | null {
  const id = normalizeEntityId(entityId);
  if (!id) return null;
  const surface = opts?.surface ?? 'light';
  const variant = pickVariant(id, role, surface);
  if (!variant) return null;
  const asset = ENTITY_LOGO_CATALOG[id]?.find((a) => a.variant === variant);
  if (!asset) return null;
  const name = entityDisplayName(id);
  return {
    entityId: id,
    role,
    surface,
    variant: asset.variant,
    docId: asset.docId,
    filename: asset.filename,
    publicUrl: `${PUBLIC_BASE}/${id}/${asset.filename}`,
    localPublicPath: `/brand/${id}/${asset.filename}`,
    alt: `${name} logo`,
  };
}

/** All catalogued logos for an entity (empty if unknown). */
export function listEntityLogoAssets(
  entityId: string | null | undefined,
): EntityLogoAsset[] {
  const id = normalizeEntityId(entityId);
  return id ? [...(ENTITY_LOGO_CATALOG[id] ?? [])] : [];
}

/** Expected brand entities with primary + icon resolvable. */
export function brandLogoEntities(): readonly string[] {
  return BRAND_ENTITY_IDS;
}

export function assertBrandLogoCoverage(): {
  ok: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  for (const id of BRAND_ENTITY_IDS) {
    if (!getEntityLogo(id, 'primary')) missing.push(`${id}:primary`);
    if (!getEntityLogo(id, 'icon')) missing.push(`${id}:icon`);
  }
  return { ok: missing.length === 0, missing };
}

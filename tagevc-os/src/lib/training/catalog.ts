/**
 * Grow · Training & Development — firm catalog + per-entity LMS (D09=C).
 * Separate LMS per entity — not Recruit-619-only system of record.
 */

export type TrainingTrack = {
  id: string;
  title: string;
  audience: string;
  modules: number;
  status: 'scaffold' | 'live';
  /** Operating entity that owns completions for this track */
  entityId?: string | null;
  href?: string;
};

export type EntityLmsSlot = {
  entityId: string;
  label: string;
  portalUrl: string;
  status: 'scaffold' | 'live';
  note: string;
};

/** One LMS SoR per entity (D09=C). */
export const ENTITY_LMS_SLOTS: EntityLmsSlot[] = [
  {
    entityId: 'ENT-FIRM',
    label: 'Tage VC LMS',
    portalUrl: 'https://app.tagevc.com/training',
    status: 'scaffold',
    note: 'Firm curriculum + Visionary tracks on Tage OS',
  },
  {
    entityId: 'ENT-R619',
    label: 'Recruit 619 LMS',
    portalUrl: 'https://portal.recruit619.com/desk/training',
    status: 'live',
    note: 'Desk LMS live — completions stay on R619',
  },
  {
    entityId: 'ENT-SIGNENT',
    label: 'Signent HR LMS',
    portalUrl: 'https://portal.signenthr.com/training',
    status: 'scaffold',
    note: 'Sales + ops training for Signent staff; client training later',
  },
  {
    entityId: 'ENT-INDA',
    label: 'Instant NDA LMS',
    portalUrl: 'https://portal.instantnda.us/training',
    status: 'scaffold',
    note: 'Left alone this pass — slot reserved',
  },
];

export const FIRM_TRAINING_CATALOG: TrainingTrack[] = [
  {
    id: 'os-onboarding',
    title: 'Tage OS onboarding',
    audience: 'All joiners',
    modules: 4,
    status: 'scaffold',
    entityId: 'ENT-FIRM',
  },
  {
    id: 'ssc-ops',
    title: 'Shared Services operating cadence',
    audience: 'SSC leads',
    modules: 3,
    status: 'scaffold',
    entityId: 'ENT-FIRM',
  },
  {
    id: 'vendor-mgmt',
    title: 'Vendor Management & renewals',
    audience: 'Ops · Finance · IT',
    modules: 5,
    status: 'scaffold',
    entityId: 'ENT-FIRM',
  },
  {
    id: 'performance-l10',
    title: 'Performance Management (L10 / Rocks)',
    audience: 'Leadership',
    modules: 6,
    status: 'scaffold',
    entityId: 'ENT-FIRM',
    href: '/eos',
  },
  {
    id: 'r619-lms',
    title: 'Recruit 619 LMS (desk)',
    audience: 'Recruit 619 staff',
    modules: 0,
    status: 'live',
    entityId: 'ENT-R619',
    href: 'https://portal.recruit619.com/desk/training',
  },
  {
    id: 'signent-lms',
    title: 'Signent HR LMS (portal)',
    audience: 'Signent sales + ops',
    modules: 0,
    status: 'scaffold',
    entityId: 'ENT-SIGNENT',
    href: 'https://portal.signenthr.com/training',
  },
];

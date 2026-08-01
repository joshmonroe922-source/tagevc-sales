/**
 * Grow · Training & Development — firm catalog scaffold.
 * Recruit 619 full LMS stays on the subsidiary desk; Tage OS inherits this hub.
 */

export type TrainingTrack = {
  id: string;
  title: string;
  audience: string;
  modules: number;
  status: 'scaffold' | 'live';
  href?: string;
};

export const FIRM_TRAINING_CATALOG: TrainingTrack[] = [
  {
    id: 'os-onboarding',
    title: 'Tage OS onboarding',
    audience: 'All joiners',
    modules: 4,
    status: 'scaffold',
  },
  {
    id: 'ssc-ops',
    title: 'Shared Services operating cadence',
    audience: 'SSC leads',
    modules: 3,
    status: 'scaffold',
  },
  {
    id: 'vendor-mgmt',
    title: 'Vendor Management & renewals',
    audience: 'Ops · Finance · IT',
    modules: 5,
    status: 'scaffold',
  },
  {
    id: 'performance-l10',
    title: 'Performance Management (L10 / Rocks)',
    audience: 'Leadership',
    modules: 6,
    status: 'scaffold',
    href: '/eos',
  },
  {
    id: 'r619-lms',
    title: 'Recruit 619 LMS (desk)',
    audience: 'Recruit 619 staff',
    modules: 0,
    status: 'live',
    href: 'https://recruit.tagevc.com/desk/training',
  },
];

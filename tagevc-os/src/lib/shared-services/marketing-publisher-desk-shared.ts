/**
 * Client-safe publisher desk constants (no process.env / Node crypto).
 */

import type { MarketingPlatform } from '@/lib/shared-services/marketing-types';
import {
  ENTITY_SELECT_LABELS,
  ENTITY_SELECT_PRIORITY_IDS,
} from '@/lib/entities/display-order';

export type ChannelReadiness = 'live' | 'scaffold' | 'missing_keys';

export type PublisherChannelDef = {
  platform: MarketingPlatform;
  label: string;
  shortLabel: string;
  kind: 'social' | 'blog';
  appConfigured: boolean;
  publishLive: boolean;
  readiness: ChannelReadiness;
  readinessLabel: string;
  missingEnv: string[];
  operatorHint: string;
};

export const PUBLISH_DESK_BRANDS = ENTITY_SELECT_PRIORITY_IDS.map((id) => ({
  entityId: id,
  label: ENTITY_SELECT_LABELS[id] ?? id,
}));

export function brandLabelForEntity(entityId: string | null | undefined): string {
  if (!entityId) return 'Firm-wide / Tage';
  return ENTITY_SELECT_LABELS[entityId] ?? entityId;
}

export const PLATFORM_CHAR_HINTS: Partial<Record<MarketingPlatform, number>> = {
  linkedin: 3000,
  x: 280,
  facebook: 63206,
  instagram: 2200,
  tiktok: 2200,
  web: 50000,
  youtube: 5000,
};

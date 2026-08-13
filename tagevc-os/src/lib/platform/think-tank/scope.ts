/**
 * Think Tank scope helpers — portal_key + entity OS isolation.
 *
 * Tage: entity_os follows the Entity OS switcher (activeEntityOs → ENT-FIRM
 * when unlocked). Subsidiary portals always pin to their one entity.
 * Threads never cross portal_key (Tage vs R619 portal) or entity_os.
 */

import {
  THINK_TANK_DEFAULT_TITLE,
  THINK_TANK_ENTITY_OS,
  type ThinkTankPortalKey,
} from '@/lib/platform/think-tank/types';

export function thinkTankEntityOs(opts: {
  portalKey: string;
  activeEntityOs?: string | null;
  profileEntityId?: string | null;
}): string {
  const portal = (opts.portalKey || '').trim().toLowerCase();
  if (portal === 'tage') {
    return (
      opts.activeEntityOs?.trim() ||
      opts.profileEntityId?.trim() ||
      THINK_TANK_ENTITY_OS.tage
    );
  }
  if (portal === 'r619') return THINK_TANK_ENTITY_OS.r619;
  if (portal === 'inda') return THINK_TANK_ENTITY_OS.inda;
  if (portal === 'signent') return THINK_TANK_ENTITY_OS.signent;
  return (
    opts.profileEntityId?.trim() ||
    opts.activeEntityOs?.trim() ||
    THINK_TANK_ENTITY_OS.tage
  );
}

export function thinkTankLastThreadKey(opts: {
  portalKey: string;
  entityOs: string;
}): string {
  return `think-tank:last:${opts.portalKey}:${opts.entityOs}`;
}

export function suggestThinkTankTitle(
  source: string,
  fallback = THINK_TANK_DEFAULT_TITLE,
): string {
  const line = source.replace(/\s+/g, ' ').trim();
  if (!line) return fallback;
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}

export function isUntitledThinkTank(title: string | null | undefined): boolean {
  const t = (title ?? '').trim().toLowerCase();
  return t === '' || t === 'think tank' || t === 'new thread';
}

export function isKnownThinkTankPortalKey(
  key: string,
): key is ThinkTankPortalKey {
  return key === 'tage' || key === 'r619' || key === 'inda' || key === 'signent';
}

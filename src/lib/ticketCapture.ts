import html2canvas from 'html2canvas';
import {
  activePortalForPath,
  getPortalDefinition,
} from './portals';
import { todoPageLabel } from './todoContext';
import type { SalesUser } from './types';
import type { TicketDiagnosticContext } from './ticketTypes';

/** Collect diagnostic context for a new ticket (always, silently). */
export function captureTicketDiagnosticContext(
  salesUser: SalesUser,
  pathname: string,
  search: string,
): TicketDiagnosticContext {
  const portalSlug = activePortalForPath(pathname, search, salesUser);
  const pageTitle =
    typeof document !== 'undefined' && document.title
      ? document.title
      : todoPageLabel(pathname, search, salesUser);
  const portalName = portalSlug
    ? getPortalDefinition(portalSlug)?.name ?? portalSlug
    : null;

  return {
    url: typeof window !== 'undefined' ? window.location.href : '',
    pathname,
    search,
    page_title: portalName ? `${pageTitle} · ${portalName}` : pageTitle,
    portal_slug: portalSlug,
    user_id: salesUser.id,
    user_email: salesUser.email,
    captured_at: new Date().toISOString(),
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    viewport: {
      width: typeof window !== 'undefined' ? window.innerWidth : 0,
      height: typeof window !== 'undefined' ? window.innerHeight : 0,
      device_pixel_ratio:
        typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    },
  };
}

/**
 * Snapshot of the current portal tab (html2canvas).
 * Does NOT capture outside the browser tab (OS desktop / other apps).
 * Failures return null so ticket create still succeeds.
 */
export async function capturePortalPageSnapshot(): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const root =
    (document.querySelector('.sales-shell') as HTMLElement | null) ??
    document.body;
  try {
    const canvas = await html2canvas(root, {
      useCORS: true,
      allowTaint: true,
      logging: false,
      scale: Math.min(window.devicePixelRatio || 1, 1.5),
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      ignoreElements: (el) => {
        const tag = el.tagName?.toLowerCase();
        if (tag === 'iframe') return true;
        if (el.classList?.contains('modal-backdrop')) return true;
        if (el.classList?.contains('rc-phone-dock')) return true;
        return false;
      },
    });
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png', 0.92);
    });
  } catch (err) {
    console.warn('Ticket page snapshot failed', err);
    return null;
  }
}

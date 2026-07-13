import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { logAuditEvent } from '../lib/audit';
import { activePortalForPath, pathRequiresPortal } from '../lib/portals';
import type { SalesUser } from '../lib/types';

type Props = {
  salesUser: SalesUser;
};

const HEARTBEAT_MS = 5 * 60 * 1000;
const PAGE_DEBOUNCE_MS = 400;

function closestAnchor(el: EventTarget | null): HTMLAnchorElement | null {
  if (!(el instanceof Element)) return null;
  return el.closest('a[href]');
}

function resolveHref(anchor: HTMLAnchorElement): string {
  try {
    return new URL(anchor.href, window.location.href).href;
  } catch {
    return anchor.getAttribute('href') ?? '';
  }
}

/**
 * Captures page views, portal opens, entity views, link clicks, print,
 * download-ish clicks, and session heartbeats for the signed-in user.
 */
export function AuditTracker({ salesUser }: Props) {
  const location = useLocation();
  const lastPathRef = useRef<string>('');
  const lastPortalRef = useRef<string | null>(null);
  const sessionStartedRef = useRef<number>(Date.now());

  // Page / portal / entity views
  useEffect(() => {
    const path = `${location.pathname}${location.search}`;
    if (path === lastPathRef.current) return;

    const timer = window.setTimeout(() => {
      lastPathRef.current = path;

      const portalSlug =
        activePortalForPath(location.pathname, location.search, salesUser) ??
        pathRequiresPortal(location.pathname);

      void logAuditEvent({
        eventType: 'page_view',
        path: location.pathname,
        user: salesUser,
        metadata: {
          search: location.search || undefined,
          portal: portalSlug ?? undefined,
        },
      });

      if (portalSlug && portalSlug !== lastPortalRef.current) {
        lastPortalRef.current = portalSlug;
        void logAuditEvent({
          eventType: 'portal_opened',
          path: location.pathname,
          user: salesUser,
          metadata: { portal: portalSlug },
        });
      }

      const entityMatch = location.pathname.match(
        /^\/sales\/ops\/entities\/([^/]+)/,
      );
      if (entityMatch?.[1] && entityMatch[1] !== 'new') {
        void logAuditEvent({
          eventType: 'entity_view',
          path: location.pathname,
          user: salesUser,
          metadata: { entity_id: entityMatch[1] },
        });
      }

      const leadMatch = location.pathname.match(
        /^\/sales\/deal-sourcing\/leads\/([^/]+)/,
      );
      if (leadMatch?.[1]) {
        void logAuditEvent({
          eventType: 'entity_view',
          path: location.pathname,
          user: salesUser,
          metadata: { lead_id: leadMatch[1], kind: 'lead' },
        });
      }
    }, PAGE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [location.pathname, location.search, salesUser]);

  // Link clicks (internal + external) + download attribute
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0) return;
      const anchor = closestAnchor(e.target);
      if (!anchor) return;

      const href = resolveHref(anchor);
      if (!href || href.startsWith('javascript:')) return;

      const downloadAttr = anchor.getAttribute('download');
      const isDownload =
        downloadAttr !== null ||
        /\.(pdf|csv|xlsx?|zip|docx?|png|jpe?g)(\?|$)/i.test(href);

      if (isDownload) {
        void logAuditEvent({
          eventType: 'download',
          path: window.location.pathname,
          user: salesUser,
          metadata: {
            destination_url: href,
            download: downloadAttr ?? true,
            link_text: (anchor.textContent ?? '').trim().slice(0, 120) || undefined,
          },
        });
        return;
      }

      void logAuditEvent({
        eventType: 'link_click',
        path: window.location.pathname,
        user: salesUser,
        metadata: {
          destination_url: href,
          target: anchor.target || undefined,
          link_text: (anchor.textContent ?? '').trim().slice(0, 120) || undefined,
          external: (() => {
            try {
              return new URL(href).origin !== window.location.origin;
            } catch {
              return true;
            }
          })(),
        },
      });
    }

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [salesUser]);

  // Print attempts
  useEffect(() => {
    function onBeforePrint() {
      void logAuditEvent({
        eventType: 'print',
        path: window.location.pathname,
        user: salesUser,
      });
    }
    window.addEventListener('beforeprint', onBeforePrint);
    return () => window.removeEventListener('beforeprint', onBeforePrint);
  }, [salesUser]);

  // Session heartbeat — approximate time-in-system
  useEffect(() => {
    sessionStartedRef.current = Date.now();

    function beat() {
      const minutes = Math.round((Date.now() - sessionStartedRef.current) / 60000);
      void logAuditEvent({
        eventType: 'session_heartbeat',
        path: window.location.pathname,
        user: salesUser,
        metadata: {
          session_minutes: minutes,
          visibility: document.visibilityState,
        },
      });
    }

    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') beat();
    }, HEARTBEAT_MS);

    return () => window.clearInterval(id);
  }, [salesUser]);

  return null;
}

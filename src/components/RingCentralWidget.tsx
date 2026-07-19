import { useEffect, useState } from 'react';
import { logContactComm } from '../lib/contactsApi';
import {
  buildAdapterScriptSrc,
  getRingCentralClientId,
  handleRcEmbeddableMessage,
  isRingCentralConfigured,
} from '../lib/ringcentral';
import type { SalesUser } from '../lib/types';

const SCRIPT_ID = 'rc-embeddable-adapter';

type Props = {
  salesUser: SalesUser;
};

/**
 * Loads RingCentral Embeddable adapter (floating softphone + SMS).
 * Users sign in inside the widget (PKCE). No shared JWT.
 */
export function RingCentralWidget({ salesUser }: Props) {
  const configured = isRingCentralConfigured();
  const [dismissedHint, setDismissedHint] = useState(false);

  useEffect(() => {
    if (!configured) return;

    const existing = document.getElementById(SCRIPT_ID);
    if (existing) return;

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = buildAdapterScriptSrc();
    script.async = true;
    document.body.appendChild(script);
    // Intentionally leave the adapter for the browser tab session so React
    // Strict Mode remounts and in-app navigation do not tear down the softphone.
  }, [configured]);

  useEffect(() => {
    if (!configured) return;

    function onMessage(event: MessageEvent) {
      const data = event.data as {
        type?: string;
        call?: Record<string, unknown>;
        message?: Record<string, unknown>;
      };
      if (!data?.type || typeof data.type !== 'string') return;
      if (!data.type.startsWith('rc-')) return;

      handleRcEmbeddableMessage(data, (input) =>
        logContactComm({
          ...input,
          createdBy: input.createdBy ?? salesUser.id,
        }),
      );
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [configured, salesUser.id]);

  if (!configured) {
    if (dismissedHint) return null;
    return (
      <div className="rc-config-hint" role="status">
        <div className="rc-config-hint-body">
          <strong>RingCentral not configured</strong>
          <p className="muted small">
            Add <code>VITE_RINGCENTRAL_CLIENT_ID</code> on Vercel and register the
            Embeddable redirect URI in the RingCentral Developer Console. See{' '}
            <code>SETUP_RINGCENTRAL.md</code>.
          </p>
        </div>
        <button
          type="button"
          className="btn ghost small"
          onClick={() => setDismissedHint(true)}
        >
          Dismiss
        </button>
      </div>
    );
  }

  // Adapter injects its own floating UI; ensure microphone capability is allowed at
  // the page level (HTTPS + Permissions-Policy / allow=microphone on their iframe).
  return (
    <div
      className="rc-widget-host"
      data-rc-client-id={getRingCentralClientId() ? 'set' : 'missing'}
      aria-hidden
    />
  );
}

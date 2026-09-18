'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { afterIdle } from '@/lib/ui/after-idle';

const CmdKPalette = dynamic(
  () => import('@/components/crm/cmd-k').then((mod) => mod.CmdKPalette),
  { ssr: false },
);

const MessagePresenceHost = dynamic(
  () =>
    import('@/components/messaging/message-presence-host').then(
      (mod) => mod.MessagePresenceHost,
    ),
  { ssr: false },
);

/**
 * Cmd+K and presence alerts stay off the first JS paint.
 * Palette mounts on first ⌘K (or after idle); presence waits for idle.
 */
export function DeferredAppChrome() {
  const [cmdk, setCmdk] = useState(false);
  const [presence, setPresence] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        setCmdk(true);
      }
    };
    window.addEventListener('keydown', onKey);
    const cancel = afterIdle(() => {
      setCmdk(true);
      setPresence(true);
    }, 2200);
    return () => {
      window.removeEventListener('keydown', onKey);
      cancel();
    };
  }, []);

  return (
    <>
      {cmdk ? <CmdKPalette /> : null}
      {presence ? <MessagePresenceHost /> : null}
    </>
  );
}

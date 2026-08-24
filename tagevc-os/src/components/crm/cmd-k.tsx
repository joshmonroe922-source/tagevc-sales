'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Hit = {
  type: 'account' | 'contact' | 'job';
  id: string;
  label: string;
  sublabel: string | null;
  href: string;
};

const STATIC: Hit[] = [
  {
    type: 'account',
    id: 'nav-crm',
    label: 'CRM graph',
    sublabel: 'Accounts & contacts',
    href: '/shared-services/crm',
  },
  {
    type: 'account',
    id: 'nav-suggestions',
    label: 'Suggestions inbox',
    sublabel: 'Accept / reject agent updates',
    href: '/shared-services/crm/suggestions',
  },
  {
    type: 'account',
    id: 'nav-docusign',
    label: 'DocuSign hub',
    sublabel: 'Library send · attach',
    href: '/shared-services/legal/docusign',
  },
  {
    type: 'account',
    id: 'nav-documents',
    label: 'Document Library',
    sublabel: 'Tage library SSOT',
    href: '/documents',
  },
  {
    type: 'account',
    id: 'nav-vendors',
    label: 'AP vendors / W-9',
    sublabel: 'A&F',
    href: '/shared-services/af/accounting/vendors',
  },
  {
    type: 'account',
    id: 'nav-w9',
    label: 'W-9 campaigns',
    sublabel: 'Outstanding + mailbox poll',
    href: '/shared-services/af/accounting/w9-campaigns',
  },
  {
    type: 'account',
    id: 'nav-forecasts',
    label: 'Forecasting',
    sublabel: '13-week cash',
    href: '/shared-services/af/finance/forecasts',
  },
  {
    type: 'account',
    id: 'nav-signent',
    label: 'Signent clients',
    sublabel: 'Client orgs · ops scaffolds',
    href: '/shared-services/signent/clients',
  },
  {
    type: 'account',
    id: 'nav-agents',
    label: 'Spine agents',
    sublabel: 'Copilot tools',
    href: '/admin/agents',
  },
  {
    type: 'account',
    id: 'nav-intake',
    label: 'Website intake',
    sublabel: 'Per-entity graph bootstrap',
    href: '/admin/intake',
  },
];

export function CmdKPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>(STATIC);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const runSearch = useCallback(async (value: string) => {
    setQ(value);
    if (value.trim().length < 2) {
      setHits(STATIC);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/spine/search?q=${encodeURIComponent(value.trim())}`,
      );
      const json = (await res.json()) as { hits?: Hit[] };
      const remote = json.hits ?? [];
      setHits(remote.length ? remote : STATIC.filter((h) =>
        h.label.toLowerCase().includes(value.toLowerCase()),
      ));
    } catch {
      setHits(STATIC);
    } finally {
      setLoading(false);
    }
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-3 py-2">
          <input
            autoFocus
            value={q}
            onChange={(e) => void runSearch(e.target.value)}
            placeholder="Search accounts, contacts, jobs… (⌘K)"
            className="w-full bg-transparent py-2 text-sm outline-none"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto py-1 text-sm">
          {loading ? (
            <li className="px-4 py-3 text-muted-foreground">Searching…</li>
          ) : hits.length === 0 ? (
            <li className="px-4 py-3 text-muted-foreground">No matches</li>
          ) : (
            hits.map((h) => (
              <li key={`${h.type}-${h.id}`}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-muted/60"
                  onClick={() => {
                    setOpen(false);
                    router.push(h.href);
                  }}
                >
                  <span>
                    <span className="font-medium">{h.label}</span>
                    {h.sublabel ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {h.sublabel}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {h.type}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          Esc to close · Enter opens selection
        </p>
      </div>
    </div>
  );
}

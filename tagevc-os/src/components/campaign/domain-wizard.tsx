'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function DomainWizard({
  domains,
}: {
  domains: Array<{
    id: string;
    domain: string;
    status: string;
    spf_ok: boolean;
    dkim_ok: boolean;
    dmarc_ok: boolean;
  }>;
}) {
  const router = useRouter();
  const [domain, setDomain] = useState('');
  const [dns, setDns] = useState<Array<{ type: string; host: string; value: string }> | null>(null);

  async function addDomain() {
    const res = await fetch('/api/campaign/v1/sending-domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain }),
    });
    const j = await res.json();
    if (res.ok) {
      setDns(j.dns_records || []);
      router.refresh();
    }
  }

  async function verify(id: string) {
    await fetch(`/api/campaign/v1/sending-domains/${id}/verify`, {
      method: 'POST',
    });
    router.refresh();
  }

  return (
    <div className="space-y-4 rounded-lg border border-[#e5e0d6] bg-white p-4">
      <h3 className="font-medium text-[#3a414f]">Sending domains</h3>
      <div className="flex gap-2">
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="mail.recruit619.com"
          className="flex-1 rounded-md border border-[#e5e0d6] px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={addDomain}
          className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white"
        >
          Add domain
        </button>
      </div>
      {dns ? (
        <pre className="overflow-auto rounded bg-[#f7f4ef] p-3 text-xs">
          {dns.map((r) => `${r.type} ${r.host} → ${r.value}`).join('\n')}
        </pre>
      ) : null}
      <ul className="space-y-2 text-sm">
        {domains.map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between rounded-md bg-[#f7f4ef] px-3 py-2"
          >
            <span>
              {d.domain} · {d.status} · SPF {d.spf_ok ? '✓' : '–'} DKIM{' '}
              {d.dkim_ok ? '✓' : '–'} DMARC {d.dmarc_ok ? '✓' : '–'}
            </span>
            <button
              type="button"
              onClick={() => verify(d.id)}
              className="text-xs underline-offset-2 hover:underline"
            >
              Verify DNS
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

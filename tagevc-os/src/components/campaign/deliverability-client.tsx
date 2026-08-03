'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function DeliverabilityClient({
  domains,
  killSwitch,
}: {
  domains: Array<{
    id: string;
    domain: string;
    status: string;
    spf_ok: boolean;
    dkim_ok: boolean;
    dmarc_ok: boolean;
  }>;
  killSwitch: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(killSwitch);
  const [msg, setMsg] = useState<string | null>(null);

  async function toggleKill(next: boolean) {
    setBusy(true);
    const res = await fetch('/api/campaign/v1/ops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resource: 'settings',
        action: 'kill_switch',
        enabled: next,
      }),
    });
    const json = await res.json();
    setBusy(false);
    if (json.ok) {
      setEnabled(next);
      setMsg(next ? 'Kill switch ON — all sends paused' : 'Kill switch off');
    } else {
      setMsg(json.error?.message || 'Failed');
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[#d7d3c3] bg-white p-4">
        <h3 className="font-heading text-base text-[#3a414f]">Kill switch</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Instantly pause all marketing sends for this entity.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            disabled={busy}
            variant={enabled ? 'destructive' : 'outline'}
            onClick={() => toggleKill(!enabled)}
          >
            {enabled ? 'Resume sending' : 'Pause all sending'}
          </Button>
          {msg ? (
            <span className="text-xs text-muted-foreground">{msg}</span>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#d7d3c3] bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#ece9e6]/70 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5">Domain</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">SPF</th>
              <th className="px-4 py-2.5">DKIM</th>
              <th className="px-4 py-2.5">DMARC</th>
            </tr>
          </thead>
          <tbody>
            {domains.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No marketing domains yet. Add mail.* DNS when Postal / owned
                  MTA goes live. Graph bulk works without this today.
                </td>
              </tr>
            ) : (
              domains.map((d) => (
                <tr key={d.id} className="border-t border-[#ece9e6]">
                  <td className="px-4 py-2.5 font-medium">{d.domain}</td>
                  <td className="px-4 py-2.5 text-xs">{d.status}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {d.spf_ok ? 'ok' : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {d.dkim_ok ? 'ok' : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {d.dmarc_ok ? 'ok' : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

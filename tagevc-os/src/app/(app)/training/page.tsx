import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ENTITY_LMS_SLOTS,
  FIRM_TRAINING_CATALOG,
} from '@/lib/training/catalog';

/**
 * Training & Development landing — Grow spine.
 * D09=C — separate LMS per entity (not R619-only SoR).
 */
export default function TrainingPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
            Grow · Training
          </p>
          <Badge variant="secondary">Per-entity LMS</Badge>
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Training & Development
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Each operating entity owns its LMS completions (D09=C). Firm catalog
          tracks live here; Recruit 619 desk LMS is live; Signent / Instant NDA
          slots are reserved.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          Entity LMS slots
        </h2>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Portal</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Note</th>
              </tr>
            </thead>
            <tbody>
              {ENTITY_LMS_SLOTS.map((s) => (
                <tr key={s.entityId} className="border-t border-border/70">
                  <td className="px-4 py-3 font-medium">{s.label}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={s.portalUrl}
                      className="underline underline-offset-2"
                    >
                      {s.portalUrl.replace(/^https?:\/\//, '')}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={s.status === 'live' ? 'default' : 'secondary'}
                    >
                      {s.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          Curriculum tracks
        </h2>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Track</th>
                <th className="px-4 py-3">Audience</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Modules</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {FIRM_TRAINING_CATALOG.map((t) => (
                <tr key={t.id} className="border-t border-border/70">
                  <td className="px-4 py-3">
                    {t.href ? (
                      <Link
                        href={t.href}
                        className="font-medium underline underline-offset-2"
                      >
                        {t.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{t.title}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {t.audience}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {t.entityId ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    {t.modules > 0 ? t.modules : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={t.status === 'live' ? 'default' : 'secondary'}
                    >
                      {t.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" render={<Link href="/eos" />}>
          Performance Management
        </Button>
        <Button variant="outline" render={<Link href="/home" />}>
          Home
        </Button>
      </div>
    </div>
  );
}

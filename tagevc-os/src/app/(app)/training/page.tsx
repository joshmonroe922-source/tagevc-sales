import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FIRM_TRAINING_CATALOG } from '@/lib/training/catalog';

/**
 * Training & Development landing — Grow spine.
 * Catalog scaffold for Tage OS; Recruit 619 full LMS remains on the desk.
 */
export default function TrainingPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
            Grow · Training
          </p>
          <Badge variant="secondary">Catalog scaffold</Badge>
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Training & Development
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Firm curriculum tracks for Tage VC and clones. Completion tracking and
          quizzes land next; Recruit 619 already runs the migrated desk LMS.
        </p>
      </header>

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
                  <td className="px-4 py-3 text-muted-foreground">{t.audience}</td>
                  <td className="px-4 py-3">
                    {t.modules > 0 ? t.modules : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={t.status === 'live' ? 'default' : 'secondary'}>
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

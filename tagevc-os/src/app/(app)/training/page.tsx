import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * Training & Development landing — Grow spine placeholder.
 * Recruit 619 ships the full LMS at /desk/training; other entities inherit this hub.
 */
export default function TrainingPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
            Grow · Training
          </p>
          <Badge variant="secondary">Scaffold</Badge>
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Training & Development
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Courses, quizzes, and progress for Tage VC. Full LMS content will land
          here; Recruit 619 already runs the migrated desk LMS under Grow.
        </p>
      </header>

      <div className="rounded-lg border border-dashed border-[#d4cfc4] bg-[#faf8f4] px-5 py-8">
        <p className="text-sm font-medium text-[#3a414f]">Coming soon</p>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          Module catalog, completion tracking, and role-aware curricula will
          mirror the Recruit 619 Training & Development experience.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" render={<Link href="/eos" />}>
            Performance Management
          </Button>
          <Button variant="outline" render={<Link href="/home" />}>
            Home
          </Button>
        </div>
      </div>
    </div>
  );
}

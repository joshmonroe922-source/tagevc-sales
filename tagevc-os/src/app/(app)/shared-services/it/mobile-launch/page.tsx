import Link from 'next/link';
import { SscFunctionHomeChromeServer } from '@/components/shared-services/ssc-function-home-chrome-server';
import {
  MOBILE_LAUNCH_DOC,
  MOBILE_LAUNCH_ERRORS,
  MOBILE_LAUNCH_PHASES,
} from '@/lib/shared-services/mobile-launch-playbook';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';

export default async function MobileAppStoreLaunchPage() {
  await requirePermission('read:it_assets');
  const ctx = await getSessionContext();
  const firmWide = ctx
    ? isFirmWideAccess(ctx.profile.role, ctx.profile.entity_id)
    : false;
  const entityId = firmWide ? null : (ctx?.profile.entity_id ?? null);

  return (
    <div className="space-y-8">
      <SscFunctionHomeChromeServer
        functionKey="it"
        entityId={entityId}
        firmWide={firmWide}
      />

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            href="/shared-services/it/assets"
            className="text-muted-foreground hover:text-foreground"
          >
            ← Technology / IT
          </Link>
          <Link
            href="/shared-services/it/technology-stack"
            className="underline underline-offset-2"
          >
            Partner stack
          </Link>
          <Link
            href="/shared-services/ops/vendor-management"
            className="underline underline-offset-2"
          >
            Vendor Management
          </Link>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">
          Mobile App Store Launch
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Shared Services operational playbook for Expo/EAS → Apple App Store +
          Google Play, with Supabase Auth (Resend hook), Stripe test→live, and
          the error catalog from Instant NDA. Future portfolio apps inherit this
          process — clone the phases, fill product-specific IDs, return new
          gotchas to the doc.
        </p>
        <p className="text-xs text-muted-foreground">
          Full checklist:{' '}
          <code className="rounded bg-muted px-1.5 py-0.5">{MOBILE_LAUNCH_DOC}</code>
          {' · '}
          Product copy:{' '}
          <code className="rounded bg-muted px-1.5 py-0.5">
            InstaNDA/docs/MOBILE_APP_STORE_LAUNCH_PLAYBOOK.md
          </code>
        </p>
      </header>

      <section className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm">
        <h2 className="font-medium">Inheritance rule</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Open a launch ticket linked to this page.</li>
          <li>Work phases 0→8; do not start store builds before EAS + secrets.</li>
          <li>
            Keep Stripe/Resend/service_role on Supabase Edge — never in EAS client
            env.
          </li>
          <li>Close the ticket only after § Common errors is updated.</li>
        </ol>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Phases</h2>
        <div className="space-y-4">
          {MOBILE_LAUNCH_PHASES.map((phase) => (
            <article
              key={phase.id}
              id={phase.id}
              className="rounded-lg border border-border px-4 py-4"
            >
              <h3 className="font-medium">{phase.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {phase.summary}
              </p>
              <ul className="mt-3 space-y-1.5 text-sm">
                {phase.items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span
                      className="mt-0.5 inline-block h-4 w-4 shrink-0 rounded border border-border"
                      aria-hidden
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">
          Common errors (fast path)
        </h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-3 py-2 font-medium">Symptom</th>
                <th className="px-3 py-2 font-medium">Fix</th>
              </tr>
            </thead>
            <tbody>
              {MOBILE_LAUNCH_ERRORS.map((row) => (
                <tr
                  key={row.symptom}
                  className="border-b border-border/70 align-top"
                >
                  <td className="px-3 py-2 font-medium">{row.symptom}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.fix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Full error table and command cheat sheet live in {MOBILE_LAUNCH_DOC}.
        </p>
      </section>

      <section className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
        <h2 className="font-medium text-foreground">First production run</h2>
        <p className="mt-1">
          Instant NDA (Jul–Aug 2026): Apple Team{' '}
          <code className="text-foreground">SSBQ54JB58</code>, ASC{' '}
          <code className="text-foreground">6796389266</code>, package{' '}
          <code className="text-foreground">com.instantnda.app</code>, EAS{' '}
          <code className="text-foreground">@joshmonroe922/instant-nda</code>,
          Supabase + Resend auth hook, Stripe live catalog including Single Use
          and Pro overage. Product status docs remain in the InstaNDA repo.
        </p>
      </section>
    </div>
  );
}

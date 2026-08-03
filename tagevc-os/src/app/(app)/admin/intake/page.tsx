import { PageHeader } from '@/components/ui/page-header';
import { requirePermission } from '@/lib/rbac/session';
import { INTAKE_ENTITIES } from '@/lib/deal-flow/org-routing';

export default async function WebsiteIntakeAdminPage() {
  await requirePermission('admin:users');
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ||
    'https://app.tagevc.com';

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Website → lead intake"
        description="Per-entity graph bootstrap. POST /api/deal-flow/website-intake with entity or org_slug. Fail-closed Graph secrets do not block lead create."
      />

      <section className="rounded-md border border-border text-sm">
        <h2 className="border-b border-border px-4 py-3 font-semibold">
          Entity endpoints
        </h2>
        <ul className="divide-y divide-border">
          {INTAKE_ENTITIES.map((e) => (
            <li key={e.key} className="space-y-1 px-4 py-3">
              <div className="font-medium">
                {e.label}{' '}
                <span className="text-xs text-muted-foreground">
                  ({e.orgSlug})
                </span>
              </div>
              <code className="block text-xs text-muted-foreground">
                POST {base}/api/deal-flow/website-intake
              </code>
              <code className="block text-xs">
                {`{ "entity": "${e.key}", "name", "email", "company", "source": "${e.defaultSource}" }`}
              </code>
              <p className="text-xs text-muted-foreground">
                Site hint: {e.websiteHint} · also{' '}
                <code>/api/deal-flow/website-intake/{e.key}</code>
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-md border border-border p-4 text-xs text-muted-foreground">
        Auth: same as existing website intake (public CORS for marketing sites +
        optional bearer). Graph bootstrap is best-effort via{' '}
        <code>bootstrapGraphFromWebsiteLead</code> onto the mapped spine org.
      </section>
    </div>
  );
}

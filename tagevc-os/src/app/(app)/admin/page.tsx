import Link from 'next/link';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { requirePermission } from '@/lib/rbac/session';

export default async function AdminPage() {
  await requirePermission('admin:users');

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Admin
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Document Library, DocuSign, users/roles, and system health. Day-to-day
          function work lives on the SSC desks.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/admin/org-chart">
          <Card className="h-full transition-colors hover:border-[#3a414f]/35">
            <CardHeader>
              <CardTitle className="text-base">Org Chart</CardTitle>
              <CardDescription>
                Reports-to · titles · Consolidated + per entity.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/admin/hire-impact">
          <Card className="h-full transition-colors hover:border-[#3a414f]/35">
            <CardHeader>
              <CardTitle className="text-base">Hire financial impact</CardTitle>
              <CardDescription>
                Role cost templates · monthly budget curve.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/documents">
          <Card className="h-full transition-colors hover:border-[#3a414f]/35">
            <CardHeader>
              <CardTitle className="text-base">Document Library</CardTitle>
              <CardDescription>
                Company files · folders · role ACL.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/shared-services/legal/docusign">
          <Card className="h-full transition-colors hover:border-[#3a414f]/35">
            <CardHeader>
              <CardTitle className="text-base">DocuSign</CardTitle>
              <CardDescription>
                Envelopes · templates · archive integrity.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/admin/email">
          <Card className="h-full transition-colors hover:border-[#3a414f]/35">
            <CardHeader>
              <CardTitle className="text-base">Email analytics</CardTitle>
              <CardDescription>
                Platform Graph/Resend opens · clicks · entity scope.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/admin/normalization">
          <Card className="h-full transition-colors hover:border-[#3a414f]/35">
            <CardHeader>
              <CardTitle className="text-base">System health</CardTitle>
              <CardDescription>
                Data readiness, soak checks, and archive tools.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/admin/ai">
          <Card className="h-full transition-colors hover:border-[#3a414f]/35">
            <CardHeader>
              <CardTitle className="text-base">AI model defaults</CardTitle>
              <CardDescription>
                Org default Grok · optional Claude · Copilot external.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Card className="opacity-70">
          <CardHeader>
            <CardTitle className="text-base">Users & roles</CardTitle>
            <CardDescription>
              Add and manage access — coming soon.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}

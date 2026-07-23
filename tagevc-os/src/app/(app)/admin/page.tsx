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
          Users, roles, and system health tools. Day-to-day work lives in the
          modules above.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
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

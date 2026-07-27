import Link from 'next/link';
import { SscFunctionHomeChromeServer } from '@/components/shared-services/ssc-function-home-chrome-server';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';

type Props = {
  searchParams?: Promise<{ entity?: string }>;
};

export default async function LegalFunctionHomePage({ searchParams }: Props) {
  await requirePermission('read:shared_services');

  const params = (await searchParams) ?? {};
  const entityParam = params.entity?.trim() ?? '';
  const ctx = await getSessionContext();
  const firmWide = ctx
    ? isFirmWideAccess(ctx.profile.role, ctx.profile.entity_id)
    : false;
  const entityId = firmWide
    ? entityParam || null
    : (ctx?.profile.entity_id ?? (entityParam || null));

  return (
    <div className="space-y-8">
      <SscFunctionHomeChromeServer
        functionKey="legal"
        entityId={entityId}
        firmWide={firmWide}
      />

      <p className="max-w-2xl text-sm text-muted-foreground">
        Use <span className="font-medium text-[#3a414f]">In this service</span>{' '}
        above for Legal tasks, counsel desk, tickets, and audits. DocuSign and
        the Document Library live under Shared Services → Admin.{' '}
        <Link
          href="/admin"
          className="font-medium underline-offset-2 hover:underline"
        >
          Open Admin →
        </Link>
      </p>
    </div>
  );
}

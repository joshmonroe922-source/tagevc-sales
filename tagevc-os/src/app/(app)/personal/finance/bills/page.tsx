import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink } from '@/components/af/af-ui';
import { requirePersonalVisionary } from '@/lib/personal/access';

export default async function Page() {
  await requirePersonalVisionary();
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Personal Finance"
        title="Bills"
        description="Personal vendors, recurring, and pay — same AP match pattern as company."
        secondaryActions={<AfBackLink href="/personal/finance" label="Personal Finance" />}
      />
      <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">
        Ready for transactional depth — kernel shared with company AP/AR engines.
      </div>
    </div>
  );
}

import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink } from '@/components/af/af-ui';
import { getCoa } from '@/lib/af';
import { requirePersonalVisionary } from '@/lib/personal/access';

export default async function PersonalCoaPage() {
  await requirePersonalVisionary();
  const coa = getCoa('PERS');
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Personal Finance"
        title="Chart of Accounts"
        description="CoA — Personal (books_id=PERS)."
        secondaryActions={<AfBackLink href="/personal/finance" label="Personal Finance" />}
      />
      <ul className="grid gap-1 text-sm sm:grid-cols-2">
        {coa.map((a) => (
          <li key={a.number} className="flex gap-2 border-b border-border/40 py-1.5">
            <span className="w-12 tabular-nums text-muted-foreground">{a.number}</span>
            <span>{a.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

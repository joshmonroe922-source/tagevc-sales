import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, StatusPill } from '@/components/af/af-ui';
import { AF_PERSONAL_FAMILY } from '@/lib/af';
import { requirePersonalVisionary } from '@/lib/personal/access';

export default async function PersonalFamilyPage() {
  await requirePersonalVisionary();
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Personal Finance"
        title="Family classes"
        description="MD — Personal Family. Class code tags every personal JE / bill / income line."
        secondaryActions={<AfBackLink href="/personal/finance" label="Personal Finance" />}
      />
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Member</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Visibility</th>
            </tr>
          </thead>
          <tbody>
            {AF_PERSONAL_FAMILY.map((m) => (
              <tr key={m.id} className="border-t border-border/70">
                <td className="px-4 py-3 font-medium">{m.name}</td>
                <td className="px-4 py-3">{m.classCode}</td>
                <td className="px-4 py-3">{m.type}</td>
                <td className="px-4 py-3"><StatusPill status={m.visibility} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

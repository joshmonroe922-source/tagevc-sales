import { VmShell } from '@/components/vendor-mgmt/vm-shell';
import { importCsvAction } from '@/app/(app)/shared-services/ops/vendor-management/actions';
import { CSV_HEADERS, type CsvImportKind } from '@/lib/vendor-mgmt/csv-import';
import { requireVmSession, vmCanWrite } from '@/lib/vendor-mgmt/session';

const KINDS = Object.keys(CSV_HEADERS) as CsvImportKind[];

export default async function ImportPage() {
  const session = await requireVmSession('view_vendors');
  const canImport =
    vmCanWrite(session, 'create_vendor') ||
    vmCanWrite(session, 'edit_contracts') ||
    vmCanWrite(session, 'manage_employees') ||
    vmCanWrite(session, 'manage_admins');

  async function action(formData: FormData) {
    'use server';
    await importCsvAction(formData);
  }

  return (
    <VmShell
      title="CSV seed import"
      description="Bulk upsert using Seed_Export header rows from Vendor Management.xlsx. Entity-scoped; deny by default."
      active="/shared-services/ops/vendor-management/import"
      adminRole={session.adminRole}
    >
      {!canImport ? (
        <p className="text-sm text-muted-foreground">
          Your role can view headers but not import. Need Vendor / Finance / HR /
          Super write.
        </p>
      ) : (
        <form action={action} className="space-y-3 rounded-lg border border-border p-4">
          <label className="block text-sm">
            <span className="text-muted-foreground">Dataset</span>
            <select
              name="kind"
              required
              className="mt-1 w-full max-w-md rounded-md border border-border px-2 py-2"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}.csv
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Paste CSV (header row required)</span>
            <textarea
              name="csv"
              required
              rows={12}
              placeholder="vendor_id,name,entity_id,..."
              className="mt-1 w-full rounded-md border border-border px-2 py-2 font-mono text-xs"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white"
          >
            Import rows
          </button>
        </form>
      )}

      <section className="space-y-2">
        <h2 className="font-heading text-lg font-semibold">Expected headers</h2>
        <ul className="space-y-2 text-xs text-muted-foreground">
          {KINDS.map((k) => (
            <li key={k}>
              <span className="font-medium text-foreground">{k}.csv</span> —{' '}
              {CSV_HEADERS[k].join(', ')}
            </li>
          ))}
        </ul>
      </section>
    </VmShell>
  );
}

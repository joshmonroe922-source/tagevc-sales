import { ENTITY_OPTIONS } from '@/components/vendor-mgmt/vm-shell';
import { VmStepUpGate } from '@/components/vendor-mgmt/step-up-gate';
import { saveVendorAction } from '@/app/(app)/shared-services/ops/vendor-management/actions';
import type { VmVendor } from '@/lib/vendor-mgmt/types';
import { redirect } from 'next/navigation';

export function VendorForm({
  vendor,
  entityLocked,
  sessionEmail,
  stepUpActive,
}: {
  vendor?: VmVendor | null;
  entityLocked?: string | null;
  sessionEmail?: string | null;
  stepUpActive?: boolean;
}) {
  async function action(formData: FormData) {
    'use server';
    const result = await saveVendorAction(formData);
    if (!result.ok) {
      throw new Error(result.error);
    }
    redirect(`/shared-services/ops/vendor-management/vendors/${result.id}`);
  }

  const v = vendor;
  return (
    <form action={action} className="mx-auto max-w-3xl space-y-6">
      {v ? <input type="hidden" name="id" value={v.id} /> : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wide text-[#3a414f] uppercase">
          Identity
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-muted-foreground">Vendor name</span>
            <input
              name="name"
              required
              defaultValue={v?.name ?? ''}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Entity</span>
            <select
              name="entity_id"
              required
              defaultValue={entityLocked || v?.entity_id || 'ENT-FIRM'}
              disabled={Boolean(entityLocked)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            >
              {ENTITY_OPTIONS.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
            {entityLocked ? (
              <input type="hidden" name="entity_id" value={entityLocked} />
            ) : null}
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Category</span>
            <input
              name="category"
              defaultValue={v?.category ?? ''}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Product</span>
            <input
              name="product"
              defaultValue={v?.product ?? ''}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            />
          </label>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wide text-[#3a414f] uppercase">
          Commercial (blue inputs)
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-muted-foreground">Pricing model</span>
            <select
              name="pricing_model"
              defaultValue={v?.pricing_model ?? 'Fixed'}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            >
              {['Per User', 'Fixed', 'Usage', 'Hybrid'].map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Billing cadence</span>
            <select
              name="billing_cadence"
              defaultValue={v?.billing_cadence ?? 'Monthly'}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            >
              {['Monthly', 'Quarterly', 'Semi-Annual', 'Annual'].map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Invoice amount</span>
            <input
              name="invoice_amount"
              type="number"
              step="0.01"
              defaultValue={v?.invoice_amount ?? 0}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Currency</span>
            <input
              name="currency"
              defaultValue={v?.currency ?? 'USD'}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Seats contracted</span>
            <input
              name="seats_contracted"
              type="number"
              defaultValue={v?.seats_contracted ?? ''}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Seats active</span>
            <input
              name="seats_active"
              type="number"
              defaultValue={v?.seats_active ?? ''}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Unit price</span>
            <input
              name="unit_price"
              type="number"
              step="0.01"
              defaultValue={v?.unit_price ?? ''}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Status</span>
            <select
              name="status"
              defaultValue={v?.status ?? 'Active'}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            >
              {['Active', 'Ended', 'Replaced'].map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wide text-[#3a414f] uppercase">
          Contract
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-muted-foreground">Start</span>
            <input
              name="contract_start"
              type="date"
              defaultValue={v?.contract_start ?? ''}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">End</span>
            <input
              name="contract_end"
              type="date"
              defaultValue={v?.contract_end ?? ''}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            />
          </label>
          <label className="flex items-center gap-2 text-sm pt-6">
            <input
              type="checkbox"
              name="auto_renew"
              defaultChecked={v?.auto_renew ?? false}
            />
            Auto-renew
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Owner</span>
            <input
              name="owner"
              defaultValue={v?.owner ?? ''}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="text-muted-foreground">
              Partner key (optional Phase 89 link)
            </span>
            <input
              name="partner_key"
              defaultValue={v?.partner_key ?? ''}
              placeholder="docusign, gusto, …"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="text-muted-foreground">Notes</span>
            <textarea
              name="notes"
              rows={3}
              defaultValue={v?.notes ?? ''}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            />
          </label>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Monthly USD, utilization, and waste are computed on save — not typed.
      </p>

      <VmStepUpGate
        email={sessionEmail ?? null}
        initiallyActive={stepUpActive}
      />

      <button
        type="submit"
        className="rounded-md bg-[#3a414f] px-4 py-2 text-sm font-medium text-white"
      >
        {v ? 'Save vendor' : 'Create vendor'}
      </button>
    </form>
  );
}

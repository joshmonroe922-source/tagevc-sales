import Link from 'next/link';
import { notFound } from 'next/navigation';
import { VendorForm } from '@/components/vendor-mgmt/vendor-form';
import { VmShell, money } from '@/components/vendor-mgmt/vm-shell';
import {
  archiveVendorAction,
  saveVendorProfileAction,
} from '@/app/(app)/shared-services/ops/vendor-management/actions';
import { enrichVendor } from '@/lib/vendor-mgmt/math';
import {
  getVendor,
  getVendorProfile,
  getVmSettings,
  listFxRates,
} from '@/lib/vendor-mgmt/repo';
import { hasValidVmStepUp } from '@/lib/vendor-mgmt/step-up';
import { requireVmSession, vmCanWrite } from '@/lib/vendor-mgmt/session';
import { redirect } from 'next/navigation';

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireVmSession('view_vendors');
  const vendor = await getVendor(id);
  if (!vendor || vendor.archived_at) notFound();

  const [profile, settings, fx] = await Promise.all([
    getVendorProfile(id),
    getVmSettings(),
    listFxRates(),
  ]);
  const rate = fx.find((r) => r.currency === vendor.currency)?.rate_to_usd ?? 1;
  const computed = enrichVendor(vendor, {
    asOf: settings?.as_of_date,
    rateToUsd: Number(rate),
  });
  const canEdit = vmCanWrite(session, 'edit_vendor');
  const canArchive = vmCanWrite(session, 'archive_vendor');
  const stepUpActive = await hasValidVmStepUp(session.email);

  async function archiveAction() {
    'use server';
    await archiveVendorAction(id);
    redirect('/shared-services/ops/vendor-management/vendors');
  }

  async function profileAction(formData: FormData) {
    'use server';
    await saveVendorProfileAction(formData);
  }

  return (
    <VmShell
      title={vendor.name}
      description={`${computed.renewal_stage} · ${money(computed.monthly_usd)}/mo computed`}
      active="/shared-services/ops/vendor-management/vendors"
      adminRole={session.adminRole}
      primaryAction={
        canArchive ? (
          <form action={archiveAction}>
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              Archive
            </button>
          </form>
        ) : null
      }
    >
      <div className="flex flex-wrap gap-6 text-sm">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            Monthly USD
          </p>
          <p className="font-heading text-xl font-semibold">
            {money(computed.monthly_usd)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            Waste / mo
          </p>
          <p className="font-heading text-xl font-semibold">
            {money(computed.waste_monthly)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            Utilization
          </p>
          <p className="font-heading text-xl font-semibold">
            {computed.utilization_pct != null
              ? `${Math.round(computed.utilization_pct * 100)}%`
              : '—'}
          </p>
        </div>
        <Link
          href="/shared-services/ops/vendor-management/renewals"
          className="self-end underline text-sm"
        >
          Renewal desk →
        </Link>
      </div>

      {canEdit ? (
        <VendorForm
          sessionEmail={session.email}
          stepUpActive={stepUpActive}
          vendor={vendor}
        />
      ) : null}

      <section className="space-y-3 border-t border-border pt-6">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          Vendor master
        </h2>
        <form action={profileAction} className="grid max-w-3xl gap-3 sm:grid-cols-2">
          <input type="hidden" name="vendor_id" value={vendor.id} />
          <input type="hidden" name="entity_id" value={vendor.entity_id} />
          <label className="text-sm">
            <span className="text-muted-foreground">Legal name</span>
            <input
              name="legal_name"
              defaultValue={profile?.legal_name ?? vendor.name}
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Security review</span>
            <select
              name="security_review"
              defaultValue={profile?.security_review ?? 'Review Due'}
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            >
              {['Approved', 'Review Due', 'Rejected'].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Primary contact</span>
            <input
              name="primary_contact"
              defaultValue={profile?.primary_contact ?? ''}
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Email</span>
            <input
              name="email"
              defaultValue={profile?.email ?? ''}
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">SLA tier</span>
            <input
              name="sla_tier"
              defaultValue={profile?.sla_tier ?? ''}
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Renewal notice days</span>
            <input
              name="renewal_notice_days"
              type="number"
              defaultValue={profile?.renewal_notice_days ?? 90}
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="text-muted-foreground">Contract URL</span>
            <input
              name="contract_url"
              defaultValue={profile?.contract_url ?? ''}
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="dpa" defaultChecked={profile?.dpa} />
            DPA on file
          </label>
          {canEdit ? (
            <button
              type="submit"
              className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white sm:col-span-2 sm:w-fit"
            >
              Save profile
            </button>
          ) : null}
        </form>
      </section>
    </VmShell>
  );
}

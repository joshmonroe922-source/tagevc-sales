import { VmShell, ENTITY_OPTIONS, money } from '@/components/vendor-mgmt/vm-shell';
import { saveRevenueAction, saveSettingsAction } from '@/app/(app)/shared-services/ops/vendor-management/actions';
import { getVmSettings, listFxRates, listRevenueInputs } from '@/lib/vendor-mgmt/repo';
import { requireVmSession, vmCanWrite } from '@/lib/vendor-mgmt/session';
import { vmEntityLabel } from '@/lib/vendor-mgmt/entities';

export default async function SettingsPage() {
  const session = await requireVmSession('view_vendors');
  const [settings, fx, revenue] = await Promise.all([
    getVmSettings(),
    listFxRates(),
    listRevenueInputs(),
  ]);
  const canEdit = vmCanWrite(session, 'edit_contracts');

  async function settingsAction(formData: FormData) {
    'use server';
    await saveSettingsAction(formData);
  }
  async function revenueAction(formData: FormData) {
    'use server';
    await saveRevenueAction(formData);
  }

  return (
    <VmShell
      title="Settings & drivers"
      description="Scenario, burden rates, FX, and TTM revenue inputs for CPE/RPE."
      active="/shared-services/ops/vendor-management/settings"
      adminRole={session.adminRole}
    >
      {settings && canEdit ? (
        <form action={settingsAction} className="grid max-w-3xl gap-3 rounded-lg border border-border p-4 sm:grid-cols-3">
          <label className="text-sm"><span className="text-muted-foreground">Scenario</span>
            <select name="scenario" defaultValue={settings.scenario} className="mt-1 w-full rounded-md border border-border px-2 py-2">
              {['Base','Bear','Bull'].map((s) => <option key={s}>{s}</option>)}
            </select></label>
          <label className="text-sm"><span className="text-muted-foreground">As-of date</span>
            <input name="as_of_date" type="date" defaultValue={settings.as_of_date} className="mt-1 w-full rounded-md border border-border px-2 py-2" /></label>
          <label className="text-sm"><span className="text-muted-foreground">Burden %</span>
            <input name="burden_pct" type="number" step="0.01" defaultValue={settings.burden_pct} className="mt-1 w-full rounded-md border border-border px-2 py-2" /></label>
          <label className="text-sm"><span className="text-muted-foreground">Benefits $/mo</span>
            <input name="benefits_monthly" type="number" defaultValue={settings.benefits_monthly} className="mt-1 w-full rounded-md border border-border px-2 py-2" /></label>
          <label className="text-sm"><span className="text-muted-foreground">Recruiting %</span>
            <input name="recruiting_pct" type="number" step="0.01" defaultValue={settings.recruiting_pct} className="mt-1 w-full rounded-md border border-border px-2 py-2" /></label>
          <label className="text-sm"><span className="text-muted-foreground">Equipment one-time</span>
            <input name="equipment_onetime" type="number" defaultValue={settings.equipment_onetime} className="mt-1 w-full rounded-md border border-border px-2 py-2" /></label>
          <button type="submit" className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white sm:w-fit">Save settings</button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          {settings ? `Scenario ${settings.scenario} · as-of ${settings.as_of_date}` : 'Apply phase90 SQL to load settings.'}
        </p>
      )}

      <section className="space-y-2">
        <h2 className="font-heading text-lg font-semibold">FX rates</h2>
        <ul className="text-sm space-y-1">
          {fx.map((r) => (
            <li key={r.currency}>{r.currency}: {r.rate_to_usd} → USD</li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-lg font-semibold">TTM revenue</h2>
        {canEdit ? (
          <form action={revenueAction} className="flex flex-wrap gap-3">
            <select name="entity_id" className="rounded-md border border-border px-2 py-2 text-sm">
              {ENTITY_OPTIONS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
            <input name="ttm_revenue" type="number" placeholder="TTM revenue" className="rounded-md border border-border px-2 py-2 text-sm" />
            <button type="submit" className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white">Save</button>
          </form>
        ) : null}
        <ul className="text-sm space-y-1">
          {revenue.map((r) => (
            <li key={r.entity_id}>{vmEntityLabel(r.entity_id)}: {money(r.ttm_revenue)}</li>
          ))}
        </ul>
      </section>
    </VmShell>
  );
}

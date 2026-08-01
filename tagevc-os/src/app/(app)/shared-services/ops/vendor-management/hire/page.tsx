import { VmShell, money } from '@/components/vendor-mgmt/vm-shell';
import { simulateHire } from '@/lib/vendor-mgmt/metrics';
import { listRoles } from '@/lib/vendor-mgmt/repo';
import { requireVmSession } from '@/lib/vendor-mgmt/session';

export default async function HirePage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; base?: string; comm?: string }>;
}) {
  const session = await requireVmSession('view_vendors');
  const sp = await searchParams;
  const roles = await listRoles(session.filterEntityId);
  const roleId = sp.role || roles[0]?.id || '';
  const baseAnnual = Number(sp.base || 120000);
  const sim = roleId
    ? await simulateHire({
        roleId,
        baseAnnual,
        commissionAnnual: Number(sp.comm || 0),
      })
    : null;

  return (
    <VmShell
      title="Hire cost simulator"
      description="Play fields: role + proposed comp → day-1 / 90d / Y1 / 3Y fully loaded including licenses."
      active="/shared-services/ops/vendor-management/hire"
      adminRole={session.adminRole}
    >
      <form className="flex flex-wrap gap-3 rounded-lg border border-border p-4" method="get">
        <label className="text-sm"><span className="text-muted-foreground">Role</span>
          <select name="role" defaultValue={roleId} className="mt-1 block rounded-md border border-border px-2 py-2">
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select></label>
        <label className="text-sm"><span className="text-muted-foreground">Proposed base</span>
          <input name="base" type="number" defaultValue={sp.base || 120000} className="mt-1 block rounded-md border border-border px-2 py-2" /></label>
        <label className="text-sm"><span className="text-muted-foreground">Commission target</span>
          <input name="comm" type="number" defaultValue={sp.comm || 0} className="mt-1 block rounded-md border border-border px-2 py-2" /></label>
        <button type="submit" className="self-end rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white">Simulate</button>
      </form>

      {!sim || !sim.settings ? (
        <p className="text-sm text-muted-foreground">Add a role first to simulate hire cost.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['Day 1', sim.timeline.day1],
            ['First 30 days', sim.timeline.d30],
            ['First 90 days', sim.timeline.d90],
            ['Year 1', sim.timeline.y1],
            ['Year 2 run-rate', sim.timeline.y2],
            ['3-year cumulative', sim.timeline.y3Cumulative],
          ].map(([label, val]) => (
            <div key={String(label)} className="border-b border-[#9F957C]/30 pb-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="font-heading text-2xl font-semibold text-[#3a414f]">{money(Number(val))}</p>
            </div>
          ))}
          <div className="sm:col-span-2 text-sm text-muted-foreground">
            Tech licenses {money(sim.tech_lic_mo, 2)}/mo · Monthly run-rate {money(sim.timeline.monthlyRunRate)}
            {sim.above_band ? ' · Above band max' : ''}
            {sim.band ? ` · Band ${money(sim.band.base_min)}–${money(sim.band.base_max)}` : ''}
          </div>
        </div>
      )}
    </VmShell>
  );
}

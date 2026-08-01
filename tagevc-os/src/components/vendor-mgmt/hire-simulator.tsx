'use client';

import { useMemo, useState } from 'react';
import { computeHireCost } from '@/lib/vendor-mgmt/normalize';
import { money } from '@/components/vendor-mgmt/vm-shell';
import type { VmRole, VmSettings } from '@/lib/vendor-mgmt/types';

const inputClass =
  'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm';

type Props = {
  settings: VmSettings | null;
  roles: VmRole[];
};

export function HireSimulator({ settings, roles }: Props) {
  const [baseSalary, setBaseSalary] = useState(120_000);
  const [commission, setCommission] = useState(0);
  const [fte, setFte] = useState(1);
  const [techLic, setTechLic] = useState(150);
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '');

  const burdenPct = settings?.burden_pct ?? 0.28;
  const benefitsMonthly = settings?.benefits_monthly ?? 450;
  const recruitingPct = settings?.recruiting_pct ?? 0.15;
  const equipmentOnetime = settings?.equipment_onetime ?? 2500;
  const training90d = settings?.training_90d ?? 1500;
  const facilitiesMonthly = settings?.facilities_monthly ?? 200;
  const mgmtOverheadPct = settings?.mgmt_overhead_pct ?? 0.08;
  const seatInflation = settings?.seat_inflation_base ?? 0.05;

  const result = useMemo(
    () =>
      computeHireCost({
        baseSalaryAnnual: baseSalary,
        commissionTargetAnnual: commission,
        fte,
        techLicMonthly: techLic,
        burdenPct,
        benefitsMonthly,
        recruitingPct,
        equipmentOnetime,
        training90d,
        facilitiesMonthly,
        mgmtOverheadPct,
        seatInflation,
      }),
    [
      baseSalary,
      commission,
      fte,
      techLic,
      burdenPct,
      benefitsMonthly,
      recruitingPct,
      equipmentOnetime,
      training90d,
      facilitiesMonthly,
      mgmtOverheadPct,
      seatInflation,
    ],
  );

  const selectedRole = roles.find((r) => r.id === roleId);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-gradient-to-br from-[#ECE9E6]/70 via-background to-background p-4">
        <h2 className="text-sm font-semibold text-[#3A414F]">Hire cost calculator</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Burden drivers from settings · Y1 / 3Y fully loaded
          {selectedRole ? ` · Role: ${selectedRole.name}` : ''}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-muted-foreground">
              Role (reference)
            </span>
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className={inputClass}
            >
              <option value="">—</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-muted-foreground">
              Base salary (annual)
            </span>
            <input
              type="number"
              min={0}
              value={baseSalary}
              onChange={(e) => setBaseSalary(Number(e.target.value) || 0)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-muted-foreground">
              Commission target (annual)
            </span>
            <input
              type="number"
              min={0}
              value={commission}
              onChange={(e) => setCommission(Number(e.target.value) || 0)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-muted-foreground">FTE</span>
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={fte}
              onChange={(e) => setFte(Number(e.target.value) || 1)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-muted-foreground">
              Tech licenses / mo
            </span>
            <input
              type="number"
              min={0}
              value={techLic}
              onChange={(e) => setTechLic(Number(e.target.value) || 0)}
              className={inputClass}
            />
          </label>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Monthly run rate" value={money(result.monthly_run_rate, 0)} />
        <Metric label="Day 1 cash" value={money(result.day1, 0)} />
        <Metric label="First 90 days" value={money(result.first_90d, 0)} />
        <Metric label="Year 1 total" value={money(result.y1_total, 0)} tone="accent" />
        <Metric label="Y2 run rate (annual)" value={money(result.y2_run_rate_annual, 0)} />
        <Metric label="3Y cumulative" value={money(result.y3_cumulative, 0)} tone="accent" />
        <Metric label="Recruiting (one-time)" value={money(result.recruiting_onetime, 0)} />
        <Metric label="One-time total" value={money(result.onetime_total, 0)} />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'accent';
}) {
  return (
    <div
      className={
        tone === 'accent'
          ? 'rounded-lg border border-[#9F957C]/50 bg-[#9F957C]/10 px-3 py-3'
          : 'rounded-lg border border-border bg-background px-3 py-3'
      }
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-[#3A414F]">{value}</div>
    </div>
  );
}

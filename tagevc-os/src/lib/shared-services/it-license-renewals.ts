/**
 * License / hardware renewal alerts (Phase 28).
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  createBroadcastNotification,
  logActivity,
} from '@/lib/data/activity';
import type { ItSoftwareLicense } from '@/lib/shared-services/it-assets-types';

export type RenewalAlertItem = {
  kind: 'license' | 'hardware';
  id: string;
  label: string;
  renewal_date: string;
  days_until: number;
  entity_id: string | null;
};

export async function scanLicenseRenewals(opts?: {
  within_days?: number;
  limit?: number;
}): Promise<{
  scanned: number;
  due: number;
  items: RenewalAlertItem[];
  notified: number;
  error?: string;
}> {
  const within = opts?.within_days ?? 30;
  const limit = opts?.limit ?? 50;
  const now = new Date();
  const horizon = new Date(now.getTime() + within * 24 * 60 * 60 * 1000);
  const horizonIso = horizon.toISOString().slice(0, 10);

  try {
    const sb = await createPersistClient();
    const { data: licenses, error } = await sb
      .from('os_it_software_licenses')
      .select(
        'license_id, product_name, vendor, status, renewal_date, entity_id',
      )
      .not('renewal_date', 'is', null)
      .lte('renewal_date', horizonIso)
      .in('status', ['active', 'pending'])
      .order('renewal_date', { ascending: true })
      .limit(limit);

    if (error) {
      return {
        scanned: 0,
        due: 0,
        items: [],
        notified: 0,
        error: error.message,
      };
    }

    const items: RenewalAlertItem[] = (licenses ?? []).map((row) => {
      const rd = String(row.renewal_date).slice(0, 10);
      const days = Math.round(
        (new Date(rd).getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      );
      return {
        kind: 'license' as const,
        id: String(row.license_id),
        label: `${row.product_name}${row.vendor ? ` · ${row.vendor}` : ''}`,
        renewal_date: rd,
        days_until: days,
        entity_id: (row.entity_id as string) ?? null,
      };
    });

    // Hardware: prefer warranty_ends_at; else purchased_at + 36 months
    const { data: hw } = await sb
      .from('os_it_hardware_assets')
      .select(
        'asset_id, kind, model, purchased_at, warranty_ends_at, entity_id, status',
      )
      .in('status', ['assigned', 'in_stock', 'repair'])
      .limit(limit);

    for (const row of hw ?? []) {
      let dueDate: Date | null = null;
      let labelSuffix = '';
      if (row.warranty_ends_at) {
        dueDate = new Date(String(row.warranty_ends_at));
        labelSuffix = 'warranty';
      } else if (row.purchased_at) {
        const purchased = new Date(String(row.purchased_at));
        if (!Number.isNaN(purchased.getTime())) {
          dueDate = new Date(purchased);
          dueDate.setFullYear(dueDate.getFullYear() + 3);
          labelSuffix = '3y refresh';
        }
      }
      if (!dueDate || Number.isNaN(dueDate.getTime())) continue;
      const days = Math.round(
        (dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      );
      if (days > within || days < -90) continue;
      items.push({
        kind: 'hardware',
        id: String(row.asset_id),
        label: `${row.kind}${row.model ? ` · ${row.model}` : ''} (${labelSuffix})`,
        renewal_date: dueDate.toISOString().slice(0, 10),
        days_until: days,
        entity_id: (row.entity_id as string) ?? null,
      });
    }

    items.sort((a, b) => a.days_until - b.days_until);

    if (items.length > 0) {
      const lines = items
        .slice(0, 12)
        .map(
          (i) =>
            `· [${i.kind}] ${i.id}: ${i.label} · ${i.renewal_date} (${i.days_until}d)`,
        )
        .join('\n');
      await createBroadcastNotification({
        kind: 'it_renewal',
        title: `IT renewals: ${items.length} due within ${within}d`,
        body: lines.slice(0, 500),
        href: '/shared-services/it/assets',
      });
      void logActivity({
        module: 'shared_services',
        action: 'it_renewal_scan',
        title: `Renewal scan: ${items.length} items`,
        ref_type: 'ticket',
        ref_id: items[0]?.id,
      });
    }

    return {
      scanned: (licenses ?? []).length + (hw ?? []).length,
      due: items.length,
      items,
      notified: items.length > 0 ? 1 : 0,
    };
  } catch (e) {
    return {
      scanned: 0,
      due: 0,
      items: [],
      notified: 0,
      error: e instanceof Error ? e.message : 'scan failed',
    };
  }
}

export function upcomingLicenseRenewals(
  licenses: ItSoftwareLicense[],
  withinDays = 30,
): ItSoftwareLicense[] {
  const now = Date.now();
  const horizon = now + withinDays * 24 * 60 * 60 * 1000;
  return licenses
    .filter((l) => {
      if (!l.renewal_date) return false;
      if (l.status !== 'active' && l.status !== 'pending') return false;
      const t = Date.parse(l.renewal_date);
      if (Number.isNaN(t)) return false;
      return t <= horizon;
    })
    .sort((a, b) =>
      String(a.renewal_date).localeCompare(String(b.renewal_date)),
    );
}

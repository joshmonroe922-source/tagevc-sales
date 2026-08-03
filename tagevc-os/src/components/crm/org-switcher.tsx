'use client';

import { useTransition } from 'react';
import { SPINE_ORG_OPTIONS } from '@/lib/spine/auth/active-org';
import { setActiveOrgAction } from '@/app/(app)/admin/org-switcher/actions';

export function OrgSwitcher({ activeSlug }: { activeSlug: string }) {
  const [pending, start] = useTransition();

  return (
    <label className="inline-flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Org</span>
      <select
        className="h-7 max-w-[10rem] rounded-md border border-border bg-background px-1.5 text-xs"
        value={activeSlug}
        disabled={pending}
        onChange={(e) => {
          const slug = e.target.value;
          start(() => void setActiveOrgAction(slug));
        }}
        title="Active subsidiary for CRM graph writes"
      >
        {SPINE_ORG_OPTIONS.map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

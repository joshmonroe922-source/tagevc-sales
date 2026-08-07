import Link from 'next/link';
import { IdentityLifecycleClient } from '@/components/shared-services/identity-lifecycle-client';
import { PageHeader } from '@/components/ui/page-header';
import { getCachedEntitySelectOptions } from '@/lib/entities/entity-select-cache';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { requirePermission } from '@/lib/rbac/session';

export default async function IdentityLifecyclePage() {
  await requirePermission('read:it_assets');

  const entities = getCachedEntitySelectOptions().map((e) => ({
    entity_id: e.value,
    label: e.label,
  }));

  let initial: Record<string, unknown> = {
    open_cases: 0,
    byod_wipe_blocks: 0,
    queued_jobs: 0,
    dead_letter: 0,
    cases: [],
    byod_registrations: [],
  };

  try {
    const sb = await createPersistClient();
    const { data } = await sb.rpc('list_identity_lifecycle_control_center', {
      p_limit: 50,
    });
    if (data && typeof data === 'object') {
      initial = data as Record<string, unknown>;
    }
  } catch {
    /* SQL may not be applied yet */
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href="/shared-services/it/assets"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Technology / IT
        </Link>
        <PageHeader
          eyebrow="Shared Services · Technology"
          title="Identity + Device Lifecycle"
          description="HRIS-driven joiner / leaver · Entra · birthright · company MDM vs BYOD MAM · attended Remote Help only."
        />
      </div>
      <IdentityLifecycleClient
        initial={initial as React.ComponentProps<
          typeof IdentityLifecycleClient
        >['initial']}
        entities={entities}
      />
    </div>
  );
}

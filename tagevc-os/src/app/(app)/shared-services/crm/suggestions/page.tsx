import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { requirePermission } from '@/lib/rbac/session';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { SuggestionsInbox } from '@/components/crm/suggestions-inbox';

export default async function CrmSuggestionsPage() {
  await requirePermission('read:shared_services');

  let rows: Array<{
    id: string;
    entity_type: string;
    entity_id: string;
    field_name: string;
    suggested_value: string | null;
    confidence: number | null;
    status: string;
    rationale: string | null;
    created_at: string;
  }> = [];
  let error: string | null = null;

  try {
    const sb = await createPersistClient();
    const { data, error: qErr } = await sb
      .from('suggested_updates')
      .select(
        'id, entity_type, entity_id, field_name, suggested_value, confidence, status, rationale, created_at',
      )
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(80);
    rows = data ?? [];
    if (qErr) error = qErr.message;
  } catch (e) {
    error = e instanceof Error ? e.message : 'suggested_updates unavailable';
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Suggestions inbox"
        description="C10 human review for agent / enrich suggested field updates."
      />
      <Link
        href="/shared-services/crm"
        className="text-sm underline underline-offset-2"
      >
        ← CRM graph
      </Link>
      {error ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}
      <SuggestionsInbox rows={rows} />
    </div>
  );
}

import { createPersistClient } from '@/lib/supabase/persist-client';
import type { IcReview } from '@/lib/types';

function icToRow(ic: IcReview) {
  return {
    id: ic.id,
    ic_id: ic.ic_id,
    deal_id: ic.deal_id,
    company_name: ic.company_name,
    status: ic.status,
    decision: ic.decision,
    conditions: ic.conditions,
    recommendation: ic.recommendation,
    decided_by: ic.decided_by,
    decided_at: ic.decided_at,
    created_at: ic.created_at,
    updated_at: ic.updated_at,
  };
}

function rowToIc(row: Record<string, unknown>): IcReview {
  return {
    id: String(row.id),
    ic_id: String(row.ic_id),
    deal_id: String(row.deal_id),
    company_name: String(row.company_name),
    status: row.status as IcReview['status'],
    decision: (row.decision as IcReview['decision']) ?? null,
    conditions: (row.conditions as string | null) ?? null,
    recommendation: (row.recommendation as string | null) ?? null,
    decided_by: (row.decided_by as string | null) ?? null,
    decided_at: (row.decided_at as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function fetchAllIcReviews(): Promise<IcReview[] | null> {
  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('os_ic_reviews')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('fetchAllIcReviews', error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToIc(r as Record<string, unknown>));
  } catch (e) {
    console.error('fetchAllIcReviews', e);
    return null;
  }
}

export async function syncIcReviews(reviews: IcReview[]): Promise<boolean> {
  try {
    const supabase = await createPersistClient();
    if (reviews.length === 0) return true;
    const { error } = await supabase
      .from('os_ic_reviews')
      .upsert(reviews.map(icToRow), { onConflict: 'ic_id' });
    if (error) {
      console.error('syncIcReviews', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('syncIcReviews', e);
    return false;
  }
}

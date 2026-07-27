import { NextResponse } from 'next/server';
import { getIesFinanceReport } from '@/lib/ies/report';
import { authorizeSubsidiaryTicketRequest } from '@/lib/multi-sub/subsidiary-ticket-auth';

/**
 * Read-only, entity-locked snapshot strip for subsidiary portals.
 * The authenticated client chooses the entity; query parameters cannot widen it.
 */
export async function GET(request: Request) {
  const auth = await authorizeSubsidiaryTicketRequest(request, 'tickets:read');
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const report = await getIesFinanceReport({
    entityId: auth.client.entity_id,
  });
  const company = report.companies.find(
    (row) => row.entity_id === auth.client.entity_id,
  );
  if (!company) {
    return NextResponse.json({
      ok: true,
      entity_id: auth.client.entity_id,
      snapshot: null,
      data_gaps: ['No IES snapshot available for this company'],
      ies_system_of_record: true,
      read_only: true,
    });
  }

  return NextResponse.json({
    ok: true,
    entity_id: company.entity_id,
    snapshot: {
      as_of: company.as_of,
      last_sync_at: company.last_sync_at,
      stale: company.stale,
      feed_status: company.feed_status,
      revenue: company.revenue,
      expenses: company.expenses,
      net_income: company.net_income,
      cash_on_hand: company.cash_on_hand,
      ar_balance: company.ar_balance,
      ap_balance: company.ap_balance,
      open_invoices: company.open_invoices,
      overdue_invoices: company.overdue_invoices,
    },
    data_gaps: company.data_gaps,
    ies_system_of_record: true,
    read_only: true,
  });
}

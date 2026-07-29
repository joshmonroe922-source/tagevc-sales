import { NextResponse } from 'next/server';
import { AF_ENTITIES, getAfStore, computeAllKpis } from '@/lib/af';
import { getSessionContext } from '@/lib/rbac/session';

export const dynamic = 'force-dynamic';

async function requireAfSession() {
  const ctx = await getSessionContext();
  if (!ctx) {
    return null;
  }
  return ctx;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
  const ctx = await requireAfSession();
  if (!ctx) {
    return NextResponse.json(
      { error: { code: 'VALIDATION', message: 'Unauthorized' } },
      { status: 401 },
    );
  }
  const { resource } = await context.params;
  const { searchParams } = new URL(request.url);
  const entityCode = searchParams.get('entity_code')?.trim() || null;
  const store = getAfStore();

  switch (resource) {
    case 'entities':
      return NextResponse.json({
        entities: AF_ENTITIES.map((e) => ({
          code: e.code,
          legal_name: e.legalName,
          currency: e.currency,
          status: e.status,
        })),
      });
    case 'invoices': {
      let rows = store.invoices;
      if (entityCode) rows = rows.filter((i) => i.entityCode === entityCode);
      return NextResponse.json({ invoices: rows });
    }
    case 'bills': {
      let rows = store.bills;
      if (entityCode) rows = rows.filter((b) => b.entityCode === entityCode);
      return NextResponse.json({ bills: rows });
    }
    case 'kpis': {
      let kpis = computeAllKpis({
        balances: store.openingBalances,
        invoices: store.invoices,
        bills: store.bills,
      });
      if (entityCode) kpis = kpis.filter((k) => k.entityCode === entityCode);
      return NextResponse.json({ kpis });
    }
    default:
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `Unknown resource ${resource}` } },
        { status: 404 },
      );
  }
}

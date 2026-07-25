import { NextResponse } from 'next/server';
import { listInvestorAssets } from '@/lib/net-worth/assets';
import {
  canViewPrivateIQuadrant,
  isPrivateIQuadrantClass,
} from '@/lib/net-worth/visibility';
import { getSessionContext } from '@/lib/rbac/session';

/**
 * Private I-quadrant balances — Visionary-only; never during Live Look.
 * Non-Visionary always 403 (does not leak existence of balances).
 */
export async function GET() {
  const ctx = await getSessionContext();
  if (
    !ctx ||
    !canViewPrivateIQuadrant({
      realRole: ctx.realRole,
      liveLookActive: ctx.liveLookActive,
    })
  ) {
    return NextResponse.json(
      { error: 'Forbidden', code: 'private_i_quadrant_denied' },
      { status: 403 },
    );
  }

  const { rows, error } = await listInvestorAssets({ scope: 'all' });
  const privateRows = rows.filter(
    (r) =>
      r.visibility_scope === 'visionary_private' ||
      isPrivateIQuadrantClass(r.asset_class),
  );
  return NextResponse.json({
    ok: true,
    count: privateRows.length,
    total: privateRows.reduce((s, r) => s + r.balance, 0),
    error: error ?? null,
  });
}

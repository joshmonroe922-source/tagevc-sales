import { NextResponse } from 'next/server';
import { getFirmAumSnapshot } from '@/lib/net-worth/assets';
import { getSessionContext } from '@/lib/rbac/session';
import { roleHasPermission } from '@/lib/types/roles';

/**
 * Firm AUM excluding private I-quadrant — role-appropriate portfolio readers.
 * Never includes stock/retirement/crypto private balances.
 */
export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx || !roleHasPermission(ctx.profile.role, 'read:portfolio')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const aum = await getFirmAumSnapshot();
  return NextResponse.json({
    ok: true,
    ...aum,
    excludes_private_i_quadrant: true,
  });
}

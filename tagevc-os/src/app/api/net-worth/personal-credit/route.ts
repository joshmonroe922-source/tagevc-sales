import { NextResponse } from 'next/server';
import { getOrCreatePersonalCreditProfile } from '@/lib/net-worth/credit';
import { canViewPersonalCredit } from '@/lib/net-worth/visibility';
import { getSessionContext } from '@/lib/rbac/session';

/** Personal credit — Visionary-only; blocked during Live Look. */
export async function GET() {
  const ctx = await getSessionContext();
  if (
    !ctx ||
    !canViewPersonalCredit({
      realRole: ctx.realRole,
      liveLookActive: ctx.liveLookActive,
    })
  ) {
    return NextResponse.json(
      { error: 'Forbidden', code: 'personal_credit_denied' },
      { status: 403 },
    );
  }

  const { profile, error } = await getOrCreatePersonalCreditProfile(
    ctx.profile.id,
  );
  return NextResponse.json({
    ok: true,
    has_profile: Boolean(profile),
    scores: profile
      ? {
          experian: profile.experian_score,
          equifax: profile.equifax_score,
          transunion: profile.transunion_score,
        }
      : null,
    error: error ?? null,
  });
}

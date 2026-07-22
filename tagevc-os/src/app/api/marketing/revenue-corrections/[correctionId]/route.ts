import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  canAccessEntityId,
  entityScopeDeniedMessage,
} from '@/lib/rbac/entity-scope';
import { guardPermission } from '@/lib/rbac/session';
import { createPersistClient } from '@/lib/supabase/persist-client';

const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().trim().min(10).max(500),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ correctionId: string }> },
) {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: 403 });
  }
  const parsed = decisionSchema.safeParse(
    await request.json().catch(() => ({})),
  );
  const { correctionId } = await context.params;
  if (!parsed.success || !z.string().uuid().safeParse(correctionId).success) {
    return NextResponse.json(
      { error: parsed.success ? 'Invalid correction ID' : parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const sb = await createPersistClient();
  const { data: correction, error: correctionError } = await sb
    .from('os_marketing_revenue_corrections')
    .select('correction_id,source_id,status')
    .eq('correction_id', correctionId)
    .maybeSingle();
  if (correctionError || !correction) {
    return NextResponse.json(
      { error: correctionError?.message ?? 'Correction not found' },
      { status: 404 },
    );
  }
  const { data: source, error: sourceError } = await sb
    .from('os_marketing_revenue_sources')
    .select('entity_id')
    .eq('source_id', correction.source_id)
    .single();
  if (sourceError || !source) {
    return NextResponse.json(
      { error: sourceError?.message ?? 'Correction source not found' },
      { status: 404 },
    );
  }
  if (
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      source.entity_id,
    )
  ) {
    return NextResponse.json(
      { error: entityScopeDeniedMessage(source.entity_id) },
      { status: 403 },
    );
  }
  const { data, error } = await sb.rpc(
    'approve_marketing_revenue_correction',
    {
      p_correction_id: correctionId,
      p_actor_id: gate.profile.id,
      p_decision: parsed.data.decision,
      p_review_reason: parsed.data.reason,
    },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return NextResponse.json({ ok: true, result: data });
}

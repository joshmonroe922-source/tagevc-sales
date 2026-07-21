import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardPermission } from '@/lib/rbac/session';
import {
  canAccessEntityId,
  entityScopeDeniedMessage,
} from '@/lib/rbac/entity-scope';
import { createPersistClient } from '@/lib/supabase/persist-client';

const schema = z.object({
  uploaded_bytes: z.number().int().nonnegative(),
  status: z.enum(['uploading', 'uploaded', 'failed']),
  error: z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ uploadId: string }> },
) {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid progress' },
      { status: 400 },
    );
  }
  const { uploadId } = await ctx.params;
  const sb = await createPersistClient();
  const { data: upload, error: findError } = await sb
    .from('os_marketing_tiktok_uploads')
    .select(
      'upload_id, content_id, account_id, entity_id, publish_id, media_size, uploaded_bytes, status, job_id',
    )
    .eq('upload_id', uploadId)
    .maybeSingle();
  if (findError || !upload) {
    return NextResponse.json(
      { error: findError?.message || 'Upload not found' },
      { status: 404 },
    );
  }
  const entityId = (upload.entity_id as string) ?? null;
  if (
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      entityId,
    )
  ) {
    return NextResponse.json(
      { error: entityScopeDeniedMessage(entityId || 'firm-wide') },
      { status: 403 },
    );
  }
  const mediaSize = Number(upload.media_size);
  if (
    parsed.data.uploaded_bytes < Number(upload.uploaded_bytes ?? 0) ||
    parsed.data.uploaded_bytes > mediaSize ||
    (parsed.data.status === 'uploaded' &&
      parsed.data.uploaded_bytes !== mediaSize)
  ) {
    return NextResponse.json(
      { error: 'Upload progress is inconsistent with acknowledged bytes' },
      { status: 409 },
    );
  }
  if (upload.job_id) {
    return NextResponse.json({
      ok: true,
      upload_id: uploadId,
      job_id: upload.job_id,
      status: upload.status,
    });
  }

  const now = new Date().toISOString();
  let jobId: string | null = null;
  if (parsed.data.status === 'uploaded') {
    jobId = `MSJ-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4)}`;
    const { error: jobError } = await sb
      .from('os_marketing_schedule_jobs')
      .insert({
        job_id: jobId,
        content_id: upload.content_id,
        account_id: upload.account_id,
        entity_id: entityId,
        status: 'queued',
        scheduled_for: now,
        attempts: 0,
        publisher: 'tiktok',
        result: {
          publish_id: upload.publish_id,
          processing: true,
          provider_status: 'PROCESSING_UPLOAD',
          submitted_at: now,
          upload_id: uploadId,
        },
        updated_at: now,
      });
    if (jobError) {
      return NextResponse.json({ error: jobError.message }, { status: 500 });
    }
    await sb
      .from('os_marketing_content')
      .update({ status: 'scheduled', scheduled_at: now, updated_at: now })
      .eq('content_id', upload.content_id);
  }
  const { error: updateError } = await sb
    .from('os_marketing_tiktok_uploads')
    .update({
      uploaded_bytes: parsed.data.uploaded_bytes,
      status:
        parsed.data.status === 'uploaded' ? 'processing' : parsed.data.status,
      job_id: jobId,
      last_error: parsed.data.error ?? null,
      updated_at: now,
    })
    .eq('upload_id', uploadId)
    .is('job_id', null);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    upload_id: uploadId,
    job_id: jobId,
    status:
      parsed.data.status === 'uploaded' ? 'processing' : parsed.data.status,
  });
}

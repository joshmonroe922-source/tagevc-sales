import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardPermission } from '@/lib/rbac/session';
import {
  canAccessEntityId,
  entityScopeDeniedMessage,
} from '@/lib/rbac/entity-scope';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { ensureFreshAccessToken } from '@/lib/shared-services/marketing-token-refresh';
import { encryptSecret } from '@/lib/shared-services/marketing-crypto';

const schema = z.object({
  account_id: z.string().min(1),
  content_id: z.string().min(1),
  media_name: z.string().min(1).max(200),
  media_type: z.enum(['video/mp4', 'video/quicktime', 'video/webm']),
  media_size: z.number().int().positive().max(4_294_967_296),
  privacy_level: z.string().min(1).max(80),
  disable_comment: z.boolean().optional(),
  disable_duet: z.boolean().optional(),
  disable_stitch: z.boolean().optional(),
});

export async function POST(request: Request) {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid upload' },
      { status: 400 },
    );
  }

  const sb = await createPersistClient();
  const [{ data: account }, { data: content }] = await Promise.all([
    sb
      .from('os_marketing_social_accounts')
      .select('account_id, entity_id, platform, account_type, status')
      .eq('account_id', parsed.data.account_id)
      .maybeSingle(),
    sb
      .from('os_marketing_content')
      .select('content_id, entity_id, platform, status, title')
      .eq('content_id', parsed.data.content_id)
      .maybeSingle(),
  ]);
  if (!account || !content) {
    return NextResponse.json(
      { error: 'TikTok account or content not found' },
      { status: 404 },
    );
  }
  const entityId = (content.entity_id as string) ?? null;
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
  if (
    account.platform !== 'tiktok' ||
    account.account_type !== 'publisher' ||
    account.status !== 'connected' ||
    ((account.entity_id as string) ?? null) !== entityId ||
    content.platform !== 'tiktok' ||
    content.status !== 'approved'
  ) {
    return NextResponse.json(
      {
        error:
          'Upload requires approved TikTok content and a connected same-entity publisher account',
      },
      { status: 409 },
    );
  }

  const fresh = await ensureFreshAccessToken(parsed.data.account_id);
  if (!fresh.token) {
    return NextResponse.json(
      { error: fresh.error || 'TikTok account must be reconnected' },
      { status: 409 },
    );
  }
  const creatorRes = await fetch(
    'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fresh.token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({}),
    },
  );
  const creator = (await creatorRes.json().catch(() => ({}))) as {
    data?: {
      creator_username?: string;
      privacy_level_options?: string[];
      comment_disabled?: boolean;
      duet_disabled?: boolean;
      stitch_disabled?: boolean;
      max_video_post_duration_sec?: number;
    };
    error?: { code?: string; message?: string };
  };
  if (
    !creatorRes.ok ||
    (creator.error?.code && creator.error.code.toLowerCase() !== 'ok')
  ) {
    return NextResponse.json(
      {
        error:
          creator.error?.message ||
          creator.error?.code ||
          `TikTok creator info HTTP ${creatorRes.status}`,
      },
      { status: 502 },
    );
  }
  const privacyOptions = creator.data?.privacy_level_options ?? [];
  if (!privacyOptions.includes(parsed.data.privacy_level)) {
    return NextResponse.json(
      {
        error: `Privacy level is not currently allowed. Choose one of: ${privacyOptions.join(', ')}`,
        privacy_options: privacyOptions,
      },
      { status: 409 },
    );
  }

  const chunkSize = Math.min(parsed.data.media_size, 10 * 1024 * 1024);
  const totalChunks = Math.ceil(parsed.data.media_size / chunkSize);
  if (totalChunks > 1000) {
    return NextResponse.json({ error: 'Video requires too many chunks' }, { status: 400 });
  }
  const initRes = await fetch(
    'https://open.tiktokapis.com/v2/post/publish/video/init/',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fresh.token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        post_info: {
          title: String(content.title ?? '').slice(0, 2200),
          privacy_level: parsed.data.privacy_level,
          disable_comment:
            Boolean(creator.data?.comment_disabled) ||
            Boolean(parsed.data.disable_comment),
          disable_duet:
            Boolean(creator.data?.duet_disabled) ||
            Boolean(parsed.data.disable_duet),
          disable_stitch:
            Boolean(creator.data?.stitch_disabled) ||
            Boolean(parsed.data.disable_stitch),
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: parsed.data.media_size,
          chunk_size: chunkSize,
          total_chunk_count: totalChunks,
        },
      }),
    },
  );
  const initialized = (await initRes.json().catch(() => ({}))) as {
    data?: { publish_id?: string; upload_url?: string };
    error?: { code?: string; message?: string };
  };
  if (
    !initRes.ok ||
    (initialized.error?.code &&
      initialized.error.code.toLowerCase() !== 'ok') ||
    !initialized.data?.publish_id ||
    !initialized.data.upload_url
  ) {
    return NextResponse.json(
      {
        error:
          initialized.error?.message ||
          initialized.error?.code ||
          `TikTok upload init HTTP ${initRes.status}`,
      },
      { status: 502 },
    );
  }
  const uploadUrlCipher = encryptSecret(initialized.data.upload_url);
  if (!uploadUrlCipher) {
    return NextResponse.json(
      { error: 'Marketing token vault is unavailable' },
      { status: 500 },
    );
  }
  const { data: upload, error } = await sb
    .from('os_marketing_tiktok_uploads')
    .insert({
      content_id: parsed.data.content_id,
      account_id: parsed.data.account_id,
      entity_id: entityId,
      publish_id: initialized.data.publish_id,
      upload_url_cipher: uploadUrlCipher,
      media_name: parsed.data.media_name,
      media_type: parsed.data.media_type,
      media_size: parsed.data.media_size,
      chunk_size: chunkSize,
      total_chunks: totalChunks,
      privacy_level: parsed.data.privacy_level,
      disable_comment: Boolean(parsed.data.disable_comment),
      disable_duet: Boolean(parsed.data.disable_duet),
      disable_stitch: Boolean(parsed.data.disable_stitch),
      creator_snapshot: creator.data ?? {},
      upload_url_expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      created_by: gate.profile.id,
    })
    .select('upload_id')
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return NextResponse.json({
    ok: true,
    upload_id: upload.upload_id,
    upload_url: initialized.data.upload_url,
    publish_id: initialized.data.publish_id,
    chunk_size: chunkSize,
    total_chunks: totalChunks,
    privacy_options: privacyOptions,
  });
}

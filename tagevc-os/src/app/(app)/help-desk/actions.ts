'use server';

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { createTicket } from '@/lib/data/ticket-store';
import { entityDisplayName } from '@/lib/entities/display-name';
import { getSessionContext, guardPermission } from '@/lib/rbac/session';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { SS_SERVICES, TICKET_PRIORITIES, type SsService } from '@/lib/types';

export type HelpDeskActionResult =
  | { ok: true; ticketId: string; message: string }
  | { ok: false; error: string };

async function uploadBytes(
  folder: string,
  filename: string,
  bytes: Buffer,
  contentType: string,
): Promise<string | null> {
  try {
    const sb = await createPersistClient();
    const path = `help-desk/${folder}/${filename}`;
    const { error } = await sb.storage
      .from('os-uploads')
      .upload(path, bytes, { contentType, upsert: true });
    if (error) return null;
    const { data } = sb.storage.from('os-uploads').getPublicUrl(path);
    return data.publicUrl || path;
  } catch {
    return null;
  }
}

export async function createHelpDeskTicketAction(
  formData: FormData,
): Promise<HelpDeskActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return { ok: false, error: gate.error };

  const session = await getSessionContext();
  const title = String(formData.get('title') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const serviceRaw = String(formData.get('service') ?? 'IT');
  const priorityRaw = String(formData.get('priority') ?? 'P2');
  const entityId = String(formData.get('entity_id') ?? 'ENT-FIRM').trim();
  const pagePath = String(formData.get('page_path') ?? '').trim();
  const screenshotDataUrl = String(formData.get('screenshot_data_url') ?? '');
  const screenshotNote = String(formData.get('screenshot_note') ?? '').trim();
  const doc = formData.get('document');

  if (title.length < 3) {
    return { ok: false, error: 'Subject must be at least 3 characters' };
  }
  const service = (
    SS_SERVICES.includes(serviceRaw as SsService) ? serviceRaw : 'IT'
  ) as SsService;
  const priority = (
    (TICKET_PRIORITIES as readonly string[]).includes(priorityRaw)
      ? priorityRaw
      : 'P2'
  ) as (typeof TICKET_PRIORITIES)[number];

  const stagingId = randomUUID();
  const linkParts: string[] = [];
  if (pagePath) linkParts.push(`page:${pagePath}`);

  if (screenshotDataUrl.startsWith('data:image')) {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(
      screenshotDataUrl,
    );
    if (match) {
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.length <= 4_500_000) {
        const url = await uploadBytes(
          stagingId,
          `screenshot-${Date.now()}.jpg`,
          bytes,
          match[1],
        );
        linkParts.push(
          url
            ? `screenshot:${url}`
            : 'screenshot:storage-unavailable',
        );
      }
    }
  } else if (screenshotNote) {
    linkParts.push(`screenshot-note:${screenshotNote}`);
  }

  if (doc instanceof File && doc.size > 0 && doc.size < 8_000_000) {
    const bytes = Buffer.from(await doc.arrayBuffer());
    const safeName = doc.name.replace(/[^\w.\-]+/g, '_').slice(0, 80);
    const url = await uploadBytes(
      stagingId,
      `doc-${Date.now()}-${safeName}`,
      bytes,
      doc.type || 'application/octet-stream',
    );
    linkParts.push(
      url ? `document:${url}` : `document:${doc.name} (upload unavailable)`,
    );
  }

  const companyName = entityDisplayName(entityId);
  const contextBits = [
    pagePath ? `Page: ${pagePath}` : null,
    screenshotNote || null,
  ].filter(Boolean);

  try {
    const ticket = createTicket({
      title,
      description:
        [description, contextBits.length ? contextBits.join(' · ') : null]
          .filter(Boolean)
          .join('\n\n') || undefined,
      service,
      priority,
      entity_id: entityId,
      company_name: companyName,
      requester_name:
        session?.profile.full_name || session?.profile.email || 'User',
      links: linkParts.length ? linkParts.join(' | ') : undefined,
    });

    revalidatePath('/help-desk');
    revalidatePath('/shared-services');
    return {
      ok: true,
      ticketId: ticket.ticket_id,
      message: `Created ${ticket.ticket_id}`,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Could not create ticket',
    };
  }
}

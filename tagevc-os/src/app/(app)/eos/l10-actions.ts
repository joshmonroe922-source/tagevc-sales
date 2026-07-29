'use server';

import { revalidatePath } from 'next/cache';
import {
  ensureWeeklyL10Meeting,
  saveL10MeetingNotes,
} from '@/lib/eos/l10-meetings';
import { getSessionContext } from '@/lib/rbac/session';
import { normalizeEntityId } from '@/lib/entities/display-name';
import { CONSOLIDATED_SELECT_VALUE } from '@/lib/entities/display-order';

export async function generateL10Action(
  entityId: string,
): Promise<{ ok: true; meetingId: string } | { ok: false; error: string }> {
  const session = await getSessionContext();
  if (!session) return { ok: false, error: 'Sign in required' };
  const id = normalizeEntityId(entityId);
  if (!id || id === CONSOLIDATED_SELECT_VALUE) {
    return { ok: false, error: 'Pick a company scope (not Consolidated).' };
  }
  const res = await ensureWeeklyL10Meeting({
    entityId: id,
    ownerProfileId: session.profile.id,
    ownerName: session.profile.full_name || session.profile.email,
  });
  if (!res.ok || !res.meeting) {
    return { ok: false, error: res.error ?? 'Generate failed' };
  }
  revalidatePath('/eos');
  revalidatePath('/documents');
  return { ok: true, meetingId: res.meeting.id };
}

export async function saveL10NotesAction(input: {
  id: string;
  notesBody: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSessionContext();
  if (!session) return { ok: false, error: 'Sign in required' };
  const res = await saveL10MeetingNotes({
    id: input.id,
    notesBody: input.notesBody,
    actorId: session.profile.id,
  });
  if (!res.ok) return { ok: false, error: res.error ?? 'Save failed' };
  revalidatePath('/eos');
  revalidatePath('/documents');
  return { ok: true };
}

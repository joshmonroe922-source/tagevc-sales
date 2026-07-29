import { createClient } from '@/lib/supabase/server';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { weekKeyFromDate } from '@/lib/eos/dates';
import { loadEosDashboard } from '@/lib/eos/dashboard';
import { DEFAULT_L10_AGENDA } from '@/lib/eos/types';
import { collectSubtreeIds, type OrgProfileNode } from '@/lib/org/tree';
import { listOrgProfiles } from '@/lib/org/repo';
import { entityDisplayName, normalizeEntityId } from '@/lib/entities/display-name';

export type L10Meeting = {
  id: string;
  team_id: string | null;
  entity_id: string;
  week_key: string;
  title: string;
  owner_profile_id: string;
  snapshot: Record<string, unknown>;
  notes_body: string;
  document_id: string | null;
  status: 'open' | 'in_progress' | 'closed';
  generated_at: string;
  saved_at: string | null;
};

function mapMeeting(row: Record<string, unknown>): L10Meeting {
  return {
    id: String(row.id),
    team_id: (row.team_id as string | null) ?? null,
    entity_id: String(row.entity_id),
    week_key: String(row.week_key),
    title: String(row.title),
    owner_profile_id: String(row.owner_profile_id),
    snapshot: (row.snapshot as Record<string, unknown>) ?? {},
    notes_body: String(row.notes_body ?? ''),
    document_id: (row.document_id as string | null) ?? null,
    status: (row.status as L10Meeting['status']) ?? 'open',
    generated_at: String(row.generated_at),
    saved_at: (row.saved_at as string | null) ?? null,
  };
}

export function buildL10DocBody(input: {
  title: string;
  weekKey: string;
  entityId: string;
  ownerName: string;
  snapshot: Record<string, unknown>;
  notesBody: string;
}): string {
  const rocks = (input.snapshot.rocks as Array<Record<string, unknown>>) ?? [];
  const issues = (input.snapshot.issues as Array<Record<string, unknown>>) ?? [];
  const todos = (input.snapshot.todos as Array<Record<string, unknown>>) ?? [];
  const scorecard =
    (input.snapshot.scorecard as Array<Record<string, unknown>>) ?? [];

  const lines: string[] = [
    `# ${input.title}`,
    ``,
    `Entity: ${entityDisplayName(input.entityId)}`,
    `Week: ${input.weekKey}`,
    `Leader: ${input.ownerName}`,
    ``,
    `## Agenda`,
    ...DEFAULT_L10_AGENDA.map((a) => `- ${a.label} (${a.minutes}m)`),
    ``,
    `## Scorecard`,
    ...scorecard.map(
      (s) =>
        `- ${s.label}: actual ${s.actual ?? '—'} / goal ${s.goal ?? '—'} (${s.on_track === true ? 'on track' : s.on_track === false ? 'off track' : 'n/a'})`,
    ),
    scorecard.length ? '' : `- (none)`,
    ``,
    `## Rocks`,
    ...rocks.map(
      (r) => `- [${r.status}] ${r.title}${r.owner_name ? ` — ${r.owner_name}` : ''}`,
    ),
    rocks.length ? '' : `- (none)`,
    ``,
    `## IDS / Issues`,
    ...issues.map(
      (i) =>
        `- [${i.priority}] ${i.title}${i.owner_name ? ` — ${i.owner_name}` : ''}`,
    ),
    issues.length ? '' : `- (none)`,
    ``,
    `## To-dos`,
    ...todos.map(
      (t) =>
        `- ${t.title}${t.assignee_name ? ` — ${t.assignee_name}` : ''}${t.due_at ? ` (due ${String(t.due_at).slice(0, 10)})` : ''}`,
    ),
    todos.length ? '' : `- (none)`,
    ``,
    `## Meeting notes`,
    input.notesBody.trim() || `_Add notes during the meeting…_`,
    ``,
  ];
  return lines.join('\n');
}

/** Word-compatible HTML (.doc) for download/print. */
export function buildL10WordHtml(bodyMarkdown: string, title: string): string {
  const escaped = bodyMarkdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const htmlBody = escaped
    .split('\n')
    .map((line) => {
      if (line.startsWith('# ')) return `<h1>${line.slice(2)}</h1>`;
      if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`;
      if (line.startsWith('- ')) return `<p>• ${line.slice(2)}</p>`;
      if (!line.trim()) return '<br/>';
      return `<p>${line}</p>`;
    })
    .join('\n');
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:w="urn:schemas-microsoft-com:office:word"
 xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8"/>
<title>${title.replace(/</g, '')}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>
body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#222}
h1{font-size:18pt;color:#3a414f}
h2{font-size:14pt;color:#3a414f;margin-top:18pt}
</style>
</head>
<body>${htmlBody}</body>
</html>`;
}

export async function listL10Meetings(input: {
  entityId?: string | null;
  ownerProfileId?: string | null;
  limit?: number;
}): Promise<{ meetings: L10Meeting[]; tableReady: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    let q = supabase
      .from('os_eos_l10_meetings')
      .select('*')
      .order('week_key', { ascending: false })
      .limit(input.limit ?? 26);
    if (input.entityId) q = q.eq('entity_id', normalizeEntityId(input.entityId));
    if (input.ownerProfileId) q = q.eq('owner_profile_id', input.ownerProfileId);
    const { data, error } = await q;
    if (error) {
      if (/does not exist|42P01/i.test(error.message)) {
        return { meetings: [], tableReady: false, error: error.message };
      }
      return { meetings: [], tableReady: true, error: error.message };
    }
    return {
      meetings: (data ?? []).map((r) => mapMeeting(r as Record<string, unknown>)),
      tableReady: true,
    };
  } catch (e) {
    return {
      meetings: [],
      tableReady: false,
      error: e instanceof Error ? e.message : 'Failed',
    };
  }
}

export async function getL10Meeting(
  id: string,
): Promise<L10Meeting | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('os_eos_l10_meetings')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return mapMeeting(data as Record<string, unknown>);
}

export async function ensureWeeklyL10Meeting(input: {
  entityId: string;
  ownerProfileId: string;
  ownerName: string;
  weekKey?: string;
  teamId?: string | null;
  teamName?: string | null;
}): Promise<{ ok: boolean; meeting?: L10Meeting; error?: string }> {
  const weekKey = input.weekKey || weekKeyFromDate();
  const entityId = normalizeEntityId(input.entityId);
  const title = `${weekKey} · ${input.teamName || entityDisplayName(entityId)} L10`;

  try {
    const supabase = await createClient();
    let existingQ = supabase
      .from('os_eos_l10_meetings')
      .select('*')
      .eq('entity_id', entityId)
      .eq('owner_profile_id', input.ownerProfileId)
      .eq('week_key', weekKey);
    if (input.teamId) existingQ = existingQ.eq('team_id', input.teamId);
    else existingQ = existingQ.is('team_id', null);
    const existing = await existingQ.maybeSingle();
    if (existing.data) {
      return { ok: true, meeting: mapMeeting(existing.data as Record<string, unknown>) };
    }

    const org = await listOrgProfiles();
    const subtree = collectSubtreeIds(org.profiles, input.ownerProfileId);
    const eos = await loadEosDashboard({
      scope: entityId,
      profileId: input.ownerProfileId,
      weekKey,
    });

    const nameById = new Map(
      org.profiles.map((p) => [p.id, p.full_name || p.email] as const),
    );

    const filterOwned = <T extends { owner_profile_id?: string | null; assignee_profile_id?: string | null }>(
      rows: T[],
      field: 'owner_profile_id' | 'assignee_profile_id',
    ) =>
      rows.filter((r) => {
        const id = r[field];
        return !id || subtree.has(id);
      });

    const snapshot = {
      week_key: weekKey,
      quarter_key: eos.quarterKey,
      rocks: filterOwned(eos.rocks, 'owner_profile_id').map((r) => ({
        title: r.title,
        status: r.status,
        owner_profile_id: r.owner_profile_id,
        owner_name: r.owner_profile_id
          ? nameById.get(r.owner_profile_id) ?? null
          : null,
      })),
      issues: filterOwned(eos.issues, 'owner_profile_id').map((i) => ({
        title: i.title,
        priority: i.priority,
        owner_profile_id: i.owner_profile_id,
        owner_name: i.owner_profile_id
          ? nameById.get(i.owner_profile_id) ?? null
          : null,
      })),
      todos: eos.todos
        .filter(
          (t) =>
            !t.assignee_profile_id || subtree.has(t.assignee_profile_id),
        )
        .map((t) => ({
          title: t.title,
          due_at: t.due_at,
          assignee_profile_id: t.assignee_profile_id,
          assignee_name: t.assignee_profile_id
            ? nameById.get(t.assignee_profile_id) ?? null
            : null,
        })),
      scorecard: eos.scorecard.map((s) => ({
        label: s.label,
        goal: s.goal,
        actual: s.actual,
        on_track: s.on_track,
      })),
    };

    const notesSeed = buildL10DocBody({
      title,
      weekKey,
      entityId,
      ownerName: input.ownerName,
      snapshot,
      notesBody: '',
    });

    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_eos_l10_meetings')
      .insert({
        team_id: input.teamId ?? null,
        entity_id: entityId,
        week_key: weekKey,
        title,
        owner_profile_id: input.ownerProfileId,
        snapshot,
        notes_body: notesSeed,
        status: 'open',
      })
      .select('*')
      .maybeSingle();

    if (error) {
      // race: unique violation → re-fetch
      if (/duplicate|unique/i.test(error.message)) {
        const again = await existingQ.maybeSingle();
        if (again.data) {
          return {
            ok: true,
            meeting: mapMeeting(again.data as Record<string, unknown>),
          };
        }
      }
      return { ok: false, error: error.message };
    }
    return { ok: true, meeting: mapMeeting(data as Record<string, unknown>) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to generate L10',
    };
  }
}

export async function saveL10MeetingNotes(input: {
  id: string;
  notesBody: string;
  actorId: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const meeting = await getL10Meeting(input.id);
    if (!meeting) return { ok: false, error: 'Meeting not found' };
    if (meeting.owner_profile_id !== input.actorId) {
      // allow firm roles via RLS; soft check only for ownership preference
    }

    const sb = await createPersistClient();
    const { error } = await sb
      .from('os_eos_l10_meetings')
      .update({
        notes_body: input.notesBody,
        saved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: 'in_progress',
      })
      .eq('id', input.id);
    if (error) return { ok: false, error: error.message };

    // Persist a Document Library copy under EOS / L10 folder
    await upsertL10DocumentLibraryCopy(meeting, input.notesBody);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Save failed' };
  }
}

async function upsertL10DocumentLibraryCopy(
  meeting: L10Meeting,
  notesBody: string,
): Promise<void> {
  try {
    const sb = await createPersistClient();
    const docId =
      meeting.document_id ||
      `L10-${meeting.entity_id}-${meeting.week_key}-${meeting.owner_profile_id.slice(0, 8)}`;
    const now = new Date().toISOString();
    const row = {
      doc_id: docId,
      entity_id: meeting.entity_id,
      doc_type: 'Other',
      title: meeting.title,
      library_path: `/EOS/L10/${meeting.week_key}/${docId}`,
      folder: 'EOS / L10',
      status: 'Draft',
      merged_body: notesBody,
      notes: `Weekly L10 · owner ${meeting.owner_profile_id}`,
      updated_at: now,
      created_at: now,
    };
    const { data, error } = await sb
      .from('os_documents')
      .upsert(row, { onConflict: 'doc_id' })
      .select('id')
      .maybeSingle();
    if (error || !data?.id) return;
    if (!meeting.document_id) {
      await sb
        .from('os_eos_l10_meetings')
        .update({ document_id: data.id })
        .eq('id', meeting.id);
    }
  } catch {
    /* soft — library optional */
  }
}

export type { OrgProfileNode };

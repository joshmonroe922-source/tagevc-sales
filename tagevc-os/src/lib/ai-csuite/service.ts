/**
 * AI C-Suite server service — Grok threads + draft actions.
 * Visionary-only. Keys never leave the server.
 */

import { grokChatCompletion, XAI_SETUP_NOTE } from '@/lib/think-tank/llm';
import {
  buildCsuiteSystemPrompt,
  buildHqSystemPrompt,
} from '@/lib/ai-csuite/prompts';
import {
  buildHqContext,
  buildRoleContext,
  type CsuiteContextPack,
} from '@/lib/ai-csuite/context';
import {
  assertCsuiteActionTransition,
  type CsuiteActionStatus,
  type CsuiteActionType,
} from '@/lib/ai-csuite/actions';
import {
  isAiCsuiteRole,
  type AiCsuiteNavRole,
  type AiCsuiteRole,
} from '@/lib/ai-csuite/roles';
import { createClient } from '@/lib/supabase/server';

export type CsuiteMessageDto = {
  id: string;
  threadId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model: string | null;
  createdAt: string;
};

async function requireVisionaryId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || profile.role !== 'visionary') {
    throw new Error('C-Suite is Visionary-only');
  }
  return profile.id as string;
}

export async function getOrCreateCsuiteThread(
  role: AiCsuiteNavRole,
): Promise<{ id: string }> {
  const visionaryId = await requireVisionaryId();
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('os_csuite_threads')
    .select('id')
    .eq('role', role)
    .eq('visionary_id', visionaryId)
    .maybeSingle();
  if (existing?.id) return { id: existing.id as string };

  const { data, error } = await supabase
    .from('os_csuite_threads')
    .insert({
      role,
      visionary_id: visionaryId,
      title: role === 'hq' ? 'C-Suite HQ' : `AI ${role.toUpperCase()}`,
    })
    .select('id')
    .maybeSingle();
  if (error || !data) {
    throw new Error(error?.message ?? 'Could not create C-Suite thread');
  }
  return { id: data.id as string };
}

export async function listCsuiteMessages(
  threadId: string,
): Promise<CsuiteMessageDto[]> {
  await requireVisionaryId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('os_csuite_messages')
    .select('id, thread_id, role, content, model, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []).map((m) => ({
    id: String(m.id),
    threadId: String(m.thread_id),
    role: m.role as CsuiteMessageDto['role'],
    content: String(m.content),
    model: m.model ? String(m.model) : null,
    createdAt: String(m.created_at),
  }));
}

export async function collectContextForRole(
  role: AiCsuiteNavRole,
  entityId?: string | null,
): Promise<CsuiteContextPack> {
  if (role === 'hq') return buildHqContext();
  return buildRoleContext(role, entityId);
}

export async function sendCsuiteMessage(opts: {
  role: AiCsuiteNavRole;
  content: string;
}): Promise<{ messages: CsuiteMessageDto[]; error?: string }> {
  const visionaryId = await requireVisionaryId();
  const thread = await getOrCreateCsuiteThread(opts.role);
  const supabase = await createClient();
  const context = await collectContextForRole(opts.role);

  await supabase.from('os_csuite_messages').insert({
    thread_id: thread.id,
    role: 'user',
    content: opts.content,
    context_meta: { visionary_id: visionaryId },
  });

  const prior = await listCsuiteMessages(thread.id);
  const system =
    opts.role === 'hq'
      ? buildHqSystemPrompt()
      : buildCsuiteSystemPrompt(opts.role as AiCsuiteRole);

  const llm = await grokChatCompletion({
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `Context JSON (fail-soft; do not invent KPIs):\n${JSON.stringify(context)}\n\nVisionary message:\n${opts.content}`,
      },
      ...prior
        .filter((m) => m.role !== 'system')
        .slice(-8)
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
    ],
    temperature: 0.35,
  });

  const assistantText =
    llm.content ??
    `Partial data mode. ${llm.error ?? XAI_SETUP_NOTE}\n\nKnown context gaps: ${(context.data_gaps ?? []).join('; ') || 'none listed'}.`;

  await supabase.from('os_csuite_messages').insert({
    thread_id: thread.id,
    role: 'assistant',
    content: assistantText,
    model: llm.model,
    context_meta: {
      data_gaps: context.data_gaps,
      health_hint: context.anomalies.length ? 'watch' : 'green',
    },
  });

  await supabase
    .from('os_csuite_threads')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', thread.id);

  const messages = await listCsuiteMessages(thread.id);
  return {
    messages,
    error: llm.content ? undefined : llm.error,
  };
}

export async function proposeCsuiteAction(opts: {
  role: AiCsuiteNavRole;
  actionType: CsuiteActionType;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const visionaryId = await requireVisionaryId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('os_csuite_actions')
    .insert({
      role: opts.role,
      action_type: opts.actionType,
      status: 'proposed',
      title: opts.title,
      body: opts.body,
      payload: opts.payload ?? {},
      created_by: visionaryId,
    })
    .select('id')
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? 'Propose failed');
  return { id: data.id as string };
}

export async function transitionCsuiteAction(opts: {
  actionId: string;
  to: CsuiteActionStatus;
}): Promise<void> {
  const visionaryId = await requireVisionaryId();
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from('os_csuite_actions')
    .select('id, status')
    .eq('id', opts.actionId)
    .maybeSingle();
  if (error || !row) throw new Error(error?.message ?? 'Action not found');
  const from = row.status as CsuiteActionStatus;
  assertCsuiteActionTransition(from, opts.to);

  const patch: Record<string, unknown> = {
    status: opts.to,
    decided_by: visionaryId,
    decided_at: new Date().toISOString(),
  };
  if (opts.to === 'executed') {
    // Draft-only: mark executed as "human confirmed draft" — no money/legal side effects here.
    patch.executed_at = new Date().toISOString();
  }
  const { error: upErr } = await supabase
    .from('os_csuite_actions')
    .update(patch)
    .eq('id', opts.actionId);
  if (upErr) throw new Error(upErr.message);
}

export function parseCsuiteRoleParam(raw: string): AiCsuiteRole | null {
  const v = raw.trim().toLowerCase();
  return isAiCsuiteRole(v) ? v : null;
}

/** TODO: weekly email digest via firm email provider — scaffold only. */
export function weeklyEmailResidualNote(): string {
  return 'TODO: wire weekly C-Suite email digest to firm email provider; store PDF under csuite-private/{visionary_id}/weekly/{role}/{week}.md.pdf';
}

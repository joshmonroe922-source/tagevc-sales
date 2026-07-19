import { supabase } from './supabase';
import type { ThinkTankMessage, ThinkTankScope } from './portfolioEntityApi';

export type ThinkTankChatResult = {
  userMessage: ThinkTankMessage;
  assistantMessage: ThinkTankMessage;
  model: string;
  scope?: ThinkTankScope;
};

export async function sendThinkTankMessage(input: {
  message: string;
  scope?: ThinkTankScope;
  entityId?: string;
}): Promise<ThinkTankChatResult> {
  if (!supabase) throw new Error('Supabase is not configured');

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const scope: ThinkTankScope =
    input.scope ?? (input.entityId ? 'entity' : 'personal');
  if (scope === 'entity' && !input.entityId) {
    throw new Error('entityId is required for entity Think Tank');
  }

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/think-tank-chat`;
  const body: Record<string, string> = {
    scope,
    message: input.message,
  };
  if (scope === 'entity' && input.entityId) {
    body.entity_id = input.entityId;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as ThinkTankChatResult & { error?: string };
  if (!res.ok) {
    throw new Error(json.error ?? `Think Tank chat failed (${res.status})`);
  }
  return json;
}

export async function analyzeFinancialsWithGrok(input: {
  entityId: string;
  periodType: string;
  periodKey: string;
  snapshot: Record<string, unknown>;
}): Promise<{ summary: string; model: string }> {
  if (!supabase) throw new Error('Supabase is not configured');

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/think-tank-chat`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      entity_id: input.entityId,
      scope: 'entity',
      mode: 'financial_analysis',
      period_type: input.periodType,
      period_key: input.periodKey,
      snapshot: input.snapshot,
    }),
  });

  const json = (await res.json()) as {
    summary?: string;
    model?: string;
    error?: string;
  };
  if (!res.ok || !json.summary) {
    throw new Error(json.error ?? `Financial analysis failed (${res.status})`);
  }
  return { summary: json.summary, model: json.model ?? 'grok' };
}
